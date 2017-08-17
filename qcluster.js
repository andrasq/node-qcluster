// qcluster:  (see also node-docs/robust-cluster.md)

'use strict';

var cluster = require('cluster');
var util = require('util');
var fs = require('fs');
var events = require('events');

var qcluster;

function QCluster( options, callback ) {
    if (!options) options = {};
    this.children = [];
    this.startTimeoutMs = options.startTimeoutMs || 30000;
    this.stopTimeoutMs = options.stopTimeoutMs || 20000;
    this.signalsToRelay = [ 'SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2', 'SIGTSTP' ];
    // note: SIGUSR1 starts the built-in debugger agent (listens on port 5858)
    this._signalsQueued = [];
    this._forking = false;

    events.EventEmitter.call(this);

    var self = this;
    process.on('message', function(msg) {
        self._hoistMessageEvent(process, msg);
    })
}
util.inherits(QCluster, events.EventEmitter);

QCluster.sendTo = function sendTo( target, name, value ) {
    // if parent, then target = child, else target = process
    try {
        var pid = target.pid || target._pid;
        var msg = { v: 'qc-1', pid: pid, n: name, m: value };
//console.log("AR: sending", msg);
        target.send(msg);
    }
    catch(err) {
        return(err);
    }
}

QCluster.sendToParent = function sendToParent( name, value ) {
    this.sendTo(process, name, value);
}

// just like console.log, but directly to the terminal, bypassing stdout
QCluster.log = function log( /* VARARGS */ ) {
    fs.writeFileSync("/dev/tty", util.format.apply(util, arguments) + '\n', {flag: 'a'});
}

/**
// return a function that waits to be called n times, then calls callback
QCluster._expectCallbacks = function _expectCallbacks( n, timeout, callback ) {
    var count = 0, done = 0;
    return function() {
        var watchdog = setTimeout(function(){ if (!done++) return callback(new Error("timeout")) });
        if ((err || ++count >= n) && !done++) { clearTimeout(watchdog); return callback(err) }
    }
}
**/

QCluster._callOnce = function _callOnce( func ) {
    var called = false;
    return function( a, b ) {
        if (!called) {
            called = true;
            func(a, b);
        }
    }
}


QCluster.prototype.handleSignals = function handleSignals( callback ) {
    var self = this;
    var signals = this.signalsToRelay;
    // TODO: accept an optional list of signals to relay

/**
    // pre-signal self with relayed signals to make Jenkins unit tests work
    // TODO: was needed for node-v0.10, but maybe no longer
    var expectCount = signals.length;
    for (var i=0; i<signals.length; i++) {
        var signal = signals[i];
        if (signal !== 'SIGSTOP' && signal !== 'SIGTSTP') {
            process.once(signal, function() {
                // note: kill is done on the next tick (node v4 and up)
                expectCount -= 1;
                if (!expectCount && callback) {
                    installRelays();
                    callback(null, self);
                }
            });
            process.kill(process.pid, signal);
        }
        else expectCount -= 1;
    }
**/
    installRelays();
    callback(null, self);

    function installRelays( ) {
        for (var i=0; i<self.signalsToRelay.length; i++) {
            (function(sig) {
                process.on(sig, function(){
                    if (self._forking) self._signalsQueued.push(sig);
                    else self._relaySignalsToChildren([sig], self.children);
                });
                // TODO: save the signal relayers so they can be uninstalled
            })(self.signalsToRelay[i]);
        }
    }
}

QCluster.prototype._fetchQueuedSignals = function _fetchQueuedSignals( ) {
    // TODO: a single signals queue supports only one-at-a-time forks
    // each forked child must 
    var signals = this._signalsQueued;
    this._signalsQueued = [];
    return signals;
}

/*
 * fork a new child process and wait for it to finish initializing
 */
QCluster.prototype.forkChild = function forkChild( options, optionalCallback ) {
    var self = this;
    if (typeof options === 'function') {
        optionalCallback = options;
        options = null;
    }
    options = options || {};

    // queue signals received while forking, to relay to child
    this._forking = true;

    var child = cluster.fork();
    if (!child) {
        var err = new Error("unable to fork");
        if (optionalCallback) return optionalCallback(err);
        else throw err;
    }
    child._pid = child.process.pid;

    // re-emit child exit events as cluster events
    child.once('exit', function() {
        self._removePid(child._pid);
        self.emit('exit', child);
    })

    child.on('message', function(msg) {
        self._hoistMessageEvent(child, msg);
    })

    self.startChild(child, function(err, child) {
        self._forking = false;
        var signals = self._fetchQueuedSignals();
        if (!err) self._relaySignalsToChildren(signals, [child]);
        else if (child && child._pid) self.killChild(child, 'SIGKILL');
        if (optionalCallback) optionalCallback(err, child);
    })

    this.children.push(child);
    this.emit('fork', child);
    return child;
}

/*
 * wait for a newly forked child process to finish initializing
 */
QCluster.prototype.startChild = function startChild( child, options, callback ) {
    var self = this;
    var startTimeoutTimer;

    if (!callback && typeof options === 'function') {
        callback = options;
        options = {};
    }
    options = options || {};

    var returned = false;
    function callbackOnce( err, child ) {
        if (!returned) {
            returned = true;
            clearTimeout(startTimeoutTimer);
            child.removeListener('ready', onChildStarted);
            child.removeListener('started', onChildStarted);
            child.removeListener('listening', onChildStarted);
            callback(err, child);
        }
    }

    startTimeoutTimer = setTimeout(onChildStartTimeout, options.startTimeoutMs || this.startTimeoutMs);
    // wait for the child to be at least 'ready' to listen for requests,
    // or be actually running and serving requests if 'started' or 'listening'
    child.once('ready', onChildStarted);
    child.once('started', onChildStarted);
    // TODO: also act on 'listening' if options.startedIfListening

    function onChildStarted() {
        callbackOnce(null, child);
    }

    function onChildStartTimeout( ) {
        // if child does not start in time, zap it
        self.killChild(child, 'SIGKILL');
        child._error = new Error("start timeout");
        // return both the timeout error and the child
        callbackOnce(child._error, child);
    }
}

QCluster.prototype.killChild = function killChild( child, signal ) {
    // 0 and 'SIGHUP' are accepted signals, but 1 ('SIGHUP') is not
    if (!signal) signal = 'SIGTERM';
    try { if (child && child._pid) process.kill(child._pid, signal) }
    catch (err) { /* suppress "not exists" and "no permissions" errors */ }
    // TODO: start a stopTimeoutTimer, re-kill if times out
}

QCluster.prototype.existsProcess = function existsProcess( pid ) {
    // kill signal delivery is on next tick, but kill error detection is sync
    try { process.kill(pid, 0); return true }
    catch (err) { return false }
}

QCluster.prototype.stopChild = function stopChild( child, callback ) {
    var stopTimeoutTimer;

    var returned = false;
    function callbackOnce(err, child) {
        if (!returned) {
            returned = true;
            clearTimer(stopTimeoutTimer);
            callback(err, child);
        }
    }

    qcluster.sendTo(child, 'stop');
    child.on('stopped', onChildStopped);
    stopTimeoutTimer = setTimeout(onStopTimeout, this.stopTimeoutMs);

    function onChildStopped() {
        callabckOnce(null, child);
    }

    function onStopTimeout( ) {
        callbackOnce(new Error("stop timeout"), child);
    }
}

/**
QCluster.prototype.replaceChild = function replaceChild( child, options ) {

TODO: write stopChild() that sends 'stop', waits for 'stopped', uses stopTimeoutMs

qc.replaceChild( child, opts )
  newChild = forkChild
    if fork threw, cb(err)
  if startTimeoutMs, return cb(new Error("startTimeout"), null)

  onNewChildReady:
    send 'stop' to old child
    if stopTimeoutMs
      unhook onOldChildStopped
      kill new child and return cb(new Error("stopTimeout"))

  # verify that parent will buffer net traffic while no children are listening
  # note: unsafe!  if new child cannot listen, have already stopped the old child!!
  onOldChildStopped:
    clear stopTimeoutTimer
    send 'start' to new child
    re-emit once 'listening' as a 'started'
    once on 'started'
        clear startTimeoutTimer
        return cb(null, newChild)
}
**/

QCluster.prototype._hoistMessageEvent = function hoistMessageEvent( target, m ) {
    // hoist child flow control messages into child events
//console.log("AR: message received", m);
    if (m && m.pid > 0 && m.v === 'qc-1') {
        switch (m.n) {
        // messages from child to parent, ie child.on and child.emit
        // forked
        // online
        // listening
        case 'ready': target.emit('ready'); break;
        case 'started': target.emit('started'); break;
        case 'stopped': target.emit('stopped'); break;
        // exit
        // messages from parent to child, ie process.on and process.emit
        case 'start': target.emit('start'); break;
        case 'stop': target.emit('stop'); break;
        case 'quit': target.emit('quit'); break;
        }
    }
}

QCluster.prototype._relaySignalsToChildren = function _relaySignalToChildren( signals, children ) {
    for (var si=0; si<signals.length; si++) {
        var signal = signals[si];
        if (signal === 'SIGTSTP') signal = 'SIGSTOP';
        for (var ci=0; ci<this.children.length; ci++) {
            try { process.kill(this.children[ci]._pid, signal) }
            catch (err) { /* ignore kill errors from non-existent processes */ }
        }
    }
}

QCluster.prototype.findPid = function findPid( pid ) {
    for (var i=0; i<this.children.length; i++) {
        if (this.children[i]._pid === pid) return this.children[i];
    }
}

QCluster.prototype._removePid = function _removePid( pid ) {
    for (var i=0, j=0; j<this.children.length; j++) {
        if (this.children[j]._pid != pid) this.children[i++] = this.children[j];
    }
    this.children.length = i;
}


qcluster = {
    isMaster: cluster.isMaster,
    isWorker: cluster.isWorker,
    createCluster: function createCluster( options, callback ) {
        return new QCluster(options, callback);
    },
    sendTo: QCluster.sendTo,
    sendToParent: QCluster.sendToParent,
    log: QCluster.log,

    // for testing:
    QCluster: QCluster,
    _delayExit: function(ms) {
        // a 0 timeout can swallow pending console output
        setTimeout(process.exit, ms || 5);
    },
}

QCluster.prototype = QCluster.prototype;

module.exports = qcluster;
