// qcluster:  (see also node-docs/robust-cluster.md)

'use strict';

var cluster = require('cluster');
var util = require('util');
var fs = require('fs');
var events = require('events');

var qcluster;

function QCluster( options ) {
    if (!options) options = {};
    this.children = [];
    this.startTimeoutMs = options.startTimeoutMs || 30000;
    this.stopTimeoutMs = options.stopTimeoutMs || 20000;
    this.startedIfListening = options.startedIfListening != null ? options.startedIfListening : true;
    this.signalsToRelay = options.signalsToRelay || [ 'SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2', 'SIGTSTP' ];
    // note: it is an error in node to listen for (the uncatchable) SIGSTOP
    // note: SIGUSR1 starts the built-in debugger agent (listens on port 5858)
    this._signalsQueued = [];
    this._forking = false;
    this._replaceQueue = [];
    this._replacing = false;
    this._signalHandlerInstalled = false;

    events.EventEmitter.call(this);

    // re-emit qcluster flow control messages in child as process events
    var self = this;
    if (!qcluster.isMaster) process.on('message', function(msg) {
        self._hoistMessageEvent(process, msg);
    })
}
util.inherits(QCluster, events.EventEmitter);

QCluster.sendTo = function sendTo( target, name, value ) {
    // parent sends to target = child, child sends to target = process
    // In both cases, the pid is the child process pid.
    try {
        var pid = target._pid || target.pid;
        var msg = { v: 'qc-1', pid: pid, n: name, m: value };
        target.send(msg);
    }
    catch(err) {
        return(err);
    }
}

QCluster.sendToParent = function sendToParent( name, value ) {
    this.sendTo(process, name, value);
}

QCluster.disconnectFrom = function disconnectFrom( target ) {
    // parent disconnects from target = child, child disconnects from parent target = process
    try { if (target.disconnect) target.disconnect() }
    catch (err) { if (err.message.indexOf("already disconnected") < 0) throw err }
}

QCluster.disconnectFromParent = function disconnectFromParent( ) {
    this.disconnectFrom(process);
}

QCluster.isQMessage = function isQMessage( m ) {
    return (m && m.v === 'qc-1' && m.pid > 0 && typeof m.n === 'string');
}

// just like console.log, but directly to the terminal, bypassing stdout
QCluster.log = function log( /* VARARGS */ ) {
    fs.writeFileSync("/dev/tty", util.format.apply(util, arguments) + '\n', {flag: 'a'});
}


/*
 * arrange for signals to be relayed to all child processes
 * This is not part of the constructor because it requires a callback.
 */
QCluster.prototype.handleSignals = function handleSignals( callback ) {
    var self = this;
    var signals = this.signalsToRelay;

    if (self._signalHandlersInstalled) {
        return callback();
    }
    // TODO: should mutex both _installing and _installed, in case of overlap
    self._signalHandlersInstalled = true;

/**
    // pre-signal self with relayed signals to make Jenkins unit tests work
    // TODO: was needed for node-v0.10, but maybe no longer
    var expectCount = signals.length;
    for (var i=0; i<signals.length; i++) {
        var signal = signals[i];
        process.once(signal, function() {
            // note: signal is delivered on next tick in node v4 and up
            expectCount -= 1;
            if (!expectCount && callback) {
                self._installRelays();
                callback(null, self);
            }
        });
        process.kill(process.pid, signal);
    }
/**/
    self._installRelays();
    callback(null, self);
}

QCluster.prototype._installRelays = function _installRelays( ) {
    var self = this;
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

    child.once('exit', function(worker) {
        self._removePid(child._pid);
        self.emit('exit', child);
    })

    // re-emit qcluster flow control messages in master as child events
    child.on('message', function(msg) {
        self._hoistMessageEvent(child, msg);
    })

    self.startChild(child, function(err, child) {
        self._forking = false;
        var signals = self._fetchQueuedSignals();
        if (!err) self._relaySignalsToChildren(signals, [child]);
        else self.killChild(child, 'SIGKILL');
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
            child.removeListener('exit', onChildExit);
            callback(err, child);
        }
    }

    startTimeoutTimer = setTimeout(onChildStartTimeout, options.startTimeoutMs || this.startTimeoutMs);
    // wait for the child to be at least 'ready' to listen for requests,
    // or be actually running and serving requests if 'started' or 'listening'
    child.once('ready', onChildStarted);
    child.once('started', onChildStarted);
    if (this.startedIfListening) child.once('listening', onChildStarted);

    child.once('exit', onChildExit);

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

    function onChildExit( ) {
        child._error = new Error("unexpected exit");
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
            // delay removing the listeners to be able to test the call-once mutexing
            // even that leaves a race that sometimes gets only one message through
            setImmediate(function() {
                child.removeListener('stopped', onChildStopped);
                child.removeListener('exit', onChildStopped);
                child.removeListener('disconnect', onChildStopped);
            })
            returned = true;
            clearTimeout(stopTimeoutTimer);
            callback(err, child);
        }
    }

    qcluster.sendTo(child, 'stop');
    child.on('stopped', onChildStopped);
    child.on('exit', onChildStopped);
    // TODO: should 'disconnect' from cluster master mean stopped?
    // if (this.startedIfListening) child.on('disconnect', onChildStopped);
    stopTimeoutTimer = setTimeout(onStopTimeout, this.stopTimeoutMs);

    function onChildStopped() {
        callbackOnce(null, child);
    }

    function onStopTimeout( ) {
        callbackOnce(new Error("stop timeout"), child);
    }
}

QCluster.prototype.isBeingReplaced = function isBeingReplaced( child ) {
    var queue = this._replaceQueue;
    for (var i=0; i<queue.length; i++) if (queue[i].child === child) return true;
    return false;
}

QCluster.prototype.replaceChild = function replaceChild( oldChild, callback ) {
    if (!oldChild) return callback(new Error("no child"));
    if (!(oldChild._pid > 0)) return callback(new Error("not our child"));
    if (!callback) throw new Error("callback required");

    this._replaceQueue.push({ child: oldChild, cb : callback });

    if (!this._replacing) {
        var self = this;
        this._replacing = true;
        setImmediate(function doReplace() {
            // replace one child at a time
            var info = self._replaceQueue.shift();
            if (!info) {
                self._replacing = false;
                return;
            }

            // only replace once
            if (info.child._currentlyBeingReplaced) {
                setImmediate(doReplace);
                return info.cb(new Error("already being replaced"));
            }
            info.child._currentlyBeingReplaced = true;

            var child = info.child;
            var cb = info.cb;
            self._doReplaceChild(child, function(err, newChild) {
                // if error, _doReplaceChild leaves child running, does not replace
                // loop to check whether done and/or replace the next child
                if (err) child._currentlyBeingReplaced = false;
                setImmediate(doReplace);
                cb(err, newChild);
            })
        })
    }
}

/*
 * replace the old child with a newly forked child worker process.
 * The workers must observe the 'ready' -> 'start' -> 'started' -> 'stop' -> 'stopped' protocol.
 */
QCluster.prototype._doReplaceChild = function _doReplaceChild( oldChild, callback ) {
    var self = this;
    var returned = false;

    // create a new child process
    var newChild = self.forkChild(function(err) {
        // new child is 'ready' or start timeout or unable to fork
        if (err) return callback(err);

        // when replacement is ready, tell old child to stop
        // The worker process must implement the 'stop' -> 'stopped' protocol.
        // Note: once we stopped the old child, if the new child dies
        // or cannot listen, we might be left short a worker.
        self.stopChild(oldChild, function(err) {
            // old child is 'stopped' (or exited) or stop timeout
            if (err) {
                // if old child did not stop, let old child run and clean up new child
                self.killChild(newChild, 'SIGKILL');
                return callback(err);
            }

            // once old child stops, tell new child to start
            // This avoids both processes being active at the same time,
            // in case the underlying code does not support concurrency.
            // The worker process must implement the 'start' -> 'started' protocol.
            // TODO: option to start new child while old is still listening (ie overlap)
            qcluster.sendTo(newChild, 'start');
            newChild.once('started', function() {
                // new child is online and listening for requests
                callback(null, newChild);
            })
        })
    })
}

// hoist flow control messages into cluster events
QCluster.prototype._hoistMessageEvent = function hoistMessageEvent( target, m ) {
    // parent re-emits flow control events on target = child, child on target = process
    if (qcluster.isQMessage(m)) {
        switch (m.n) {
        // messages on parent side, ie child.on
        // fork - by nodejs when process created
        // online - by nodejs when nodejs started
        // listening - by nodejs when process listening on socket
        case 'ready': target.emit('ready'); break;
        case 'started': target.emit('started'); break;
        case 'stopped': target.emit('stopped'); break;
        case 'listening': target.emit('listening'); break;      // simulated 'listening' event
        // exit - by nodejs when process exited

        // messages on child side, ie process.on
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


function repeatUntil( action, cb ) {
    (function loop() {
        action(function(err, stop) {
            if (err || stop) return cb(err, stop);
            else loop();
        })
    })();
}

function iterate( actions, done ) {
    var ix = 0;
    repeatUntil(function(cb) {
        if (ix >= actions.length) return cb(null, true);
        actions[ix++](cb);
    }, done);
}

qcluster = {
    isMaster: cluster.isMaster,
    isWorker: cluster.isWorker,
    createCluster: function createCluster( options, callback ) {
        if (!callback && typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!options) options = {};
        var qm = new QCluster(options);

        // delay the setup until the next tick to make unit testable
        setImmediate(function() {
            iterate([
                function(cb) {
                    if (options.omitSignalHandler) return cb();
                    qm.handleSignals(function(err) { cb(err) });
                },
                function(cb) {
                    if (options.clusterSize > 0) {
                        var forkCount = 0;
                        var forkErrors = [];

                        // start the workers concurrently
                        for (var i=0; i<options.clusterSize; i++) {
                            qm.forkChild(function(err) {
                                forkCount += 1;
                                if (err) forkErrors.push(err);
                                if (forkCount == options.clusterSize) {
                                    if (forkErrors.length) return cb(forkErrors[0]);
                                    return cb();
                                }
                            })
                        }
                    }
                    else cb();
                },
            ],
            function(err) {
                if (callback) callback(err);
            })
        })
        return qm;
    },
    sendTo: QCluster.sendTo,
    sendToParent: QCluster.sendToParent,
    isQMessage: QCluster.isQMessage,
    disconnectFrom: QCluster.disconnectFrom,
    disconnectFromParent: QCluster.disconnectFromParent,
    log: QCluster.log,

    // for testing:
    QCluster: QCluster,
    _delayExit: function(ms) {
        // a 0 timeout can swallow pending console output
        setTimeout(process.exit, ms || 5);
    },
    repeatUntil: repeatUntil,
    iterate: iterate,
}

QCluster.prototype = QCluster.prototype;

module.exports = qcluster;
