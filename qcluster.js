// qcluster:  (see also node-docs/robust-cluster.md)

'use strict';

var cluster = require('cluster');
var util = require('util');
var fs = require('fs');
var events = require('events');

var qcluster;

// re-emit qcluster flow control messages as events.
// Listening to 'disconnect' or 'message' events ref-s the IPC channel,
// preventing the child process from exiting until it first disconnects.
if (!cluster.isMaster) {
    // child cluster events arrive as messages on process
    process.on('message', function(msg) { QCluster._hoistMessageEvent(process, msg) });
}

function QCluster( options ) {
    if (!options) options = {};
    this.children = [];

    this.startTimeoutMs = options.startTimeoutMs || 30000;
    this.stopTimeoutMs = options.stopTimeoutMs || 20000;
    this.startedIfListening = options.startedIfListening != null ? options.startedIfListening : true;
    this.disconnectIfStop = options.disconnectIfStop || false;
    this.signalsToRelay = options.signalsToRelay || [ 'SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2', 'SIGTSTP', 'SIGCONT' ];
    // note: it is an error in node to listen for (the uncatchable) SIGSTOP
    // note: SIGUSR1 starts the built-in debugger agent (listens on port 5858)

    this._signalsQueued = [];
    this._forking = false;
    this._replaceQueue = [];
    this._replacing = false;
    this._signalHandlerInstalled = false;

    events.EventEmitter.call(this);
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


/**
QCluster.prototype.childrenCount = function childrenCount( ) {
    var count = 0;
    for (var i=0; i<this.children.length; i++) {
        if (this.children[i].isConnected()) count += 1;
    }
    return count;
}
**/

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
                self.emit('trace', "relaying signal %s", sig);
                if (self._forking) self._signalsQueued.push(sig);
                else self._relaySignalsToChildren([sig], self.children);
                // suspend self on ^Z
                if (sig === 'SIGTSTP') setImmediate(function() { process.kill(process.pid, 'SIGSTOP') });
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
QCluster.prototype.forkChild = function forkChild( optionalCallback ) {
    var self = this;

    // queue signals received while forking, to relay to child
    this._forking = true;

    var child = cluster.fork();
    if (!child) {
        // not clear that fork ever not returns an object, but just in case...
        this.emit('trace', "unable to fork");
        var err = new Error("unable to fork");
        if (optionalCallback) return optionalCallback(err, child);
        else self.emit('error', err);
    }
    child._pid = child.process.pid;
    this.emit('trace', "forked new worker #%d", child._pid);

    // re-emit qcluster flow control messages in master as child events
    // node-v0.10 does not emit child messages also as cluster.on message
    child.on('message', function(msg) {
        self._hoistMessageEvent(child, msg);
    })

    child.once('exit', function() {
        self.emit('trace', "worker #%d exited", child._pid);
        self._removePid(child._pid);
        self.emit('exit', child);
    })

    child.once('ready', function() {
        self.emit('trace', "new worker #%d 'ready'", child._pid)
    })
    child.once('started', function() {
        self._isStarted = true;
        self.emit('trace', "new worker #%d 'started'", child._pid);
    })
    child.once('listening', function() {
        self._isStarted = true;
        self.emit('trace', "new worker #%d 'listening'", child._pid);
    })
    child.once('disconnect', function() {
        self.emit('trace', "worker #%d 'disconnect'", child._pid)
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
        self.emit('trace', "new worker #%d failed to start in %d ms", child._pid, self.startTimeoutMs);

        // if child does not start in time, zap it
        self.killChild(child, 'SIGKILL');

        // return both the timeout error and the child
        child._error = new Error("start timeout");
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

/*
 * Tell the child to stop listening for requests.
 */
QCluster.prototype.stopChild = function stopChild( child, callback ) {
    var self = this;
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

    // disconnect() old worker to guarantee that it will run no more calls.
    // Disconnect after stopChild has installed its exit listeners.
    // Without disconnect() the new and old workers are simultaneously active for
    // a few ms until the worker replies that is has closed its listen ports.
    // We prefer to keep the IPC connection open to allow the qcluster manager to
    // continue to receive messages from the old worker until it exits.
    //
    if (self.disconnectIfStop) child.disconnect();

    child.on('stopped', onChildStopped);
    child.on('exit', onChildStopped);
    // TODO: should 'disconnect' from cluster master mean stopped?
    // if (this.startedIfListening) child.on('disconnect', onChildStopped);
    stopTimeoutTimer = setTimeout(onStopTimeout, this.stopTimeoutMs);

    function onChildStopped() {
        self.emit('trace', "worker #%d stopped", child._pid);
        callbackOnce(null, child);
    }

    function onStopTimeout( ) {
        self.emit('trace', "worker #%d failed to stop in %d ms", child._pid, self.stopTimeoutMs);
        callbackOnce(new Error("stop timeout"), child);
    }
}

QCluster.prototype.isBeingReplaced = function isBeingReplaced( child ) {
    var queue = this._replaceQueue;
    for (var i=0; i<queue.length; i++) if (queue[i].child === child) return true;
    return false;
}

QCluster.prototype.cancelReplace = function cancelReplace( child ) {
    var queue = this._replaceQueue;
    for (var i=0; i<queue.length; i++) if (queue[i].child === child) {
        queue.splice(i, 1);
        i--;
    }
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

            self.emit('trace', "replacing worker #%d", info.child._pid);
            var child = info.child;
            var cb = info.cb;
            self._doReplaceChild(child, function(err, newChild) {
                // if error, _doReplaceChild leaves child running, does not replace
                // loop to check whether done and/or replace the next child
                if (err) {
                    child._currentlyBeingReplaced = false;
                    self.emit('trace', "could not replace worker #%d with #%d: %s", child._pid, newChild ? newChild._pid : 0, err.message);
                } else {
                    self.emit('trace', "replaced worker #%d with new worker #%d", child._pid, newChild._pid);
                }
                setImmediate(doReplace);
                cb(err, newChild);
            })
        })
    }
}

/*
 * replace the old child with a newly forked child worker process.
 */
QCluster.prototype._doReplaceChild = function _doReplaceChild( oldChild, callback ) {
    var self = this;
    var returned = false;

    // create a new worker process
    var newChild = self.forkChild(function(err, newChild) {
        if (err) {
            // start timeout or unable to fork
            if (newChild) {
                newChild.removeListener('listening', onStarted);
                newChild.removeListener('started', onStarted);
            }
            return callback(err, newChild);
        }
        else {
            // 'ready', 'started' or 'listening'
            // tyipcally the worker sends 'ready', tell it to start
            // workers that send 'listening' should ignore 'start'
            qcluster.sendTo(newChild, 'start');
        }
    })

    /*
     * Ideally we would like full hanshaking, telling the worker to transition
     * 'ready' -> 'start' -> 'started' and 'stop' -> 'stopped' -> 'quit'.
     * However, nodejs does not keep the socket open between workers, and
     * keeps sending requests to a worker until it closes all listen sockets.
     *
     * So we use a truncated handshake with a small overlap, letting the 'listening'
     * (or 'started') of the new worker trigger the 'close' of the old worker, and
     * hoping that the old worker closes its socket with minimal delay.  The overlap
     * should be at most a few milliseconds.
     */

    if (newChild && !newChild._isStarted) {
        newChild.once('started', onStarted);
        if (this.startedIfListening) newChild.once('listening', onStarted);
    }
    function onStarted() {
        // new child is online and listening for requests, old child should stop
        // note: nodejs adds a worker to the pool as soon as it is 'listening'
        // on *any* port, and removes it only after 'disconnect' from *all* ports.
        //
        newChild.removeListener('started', onStarted);
        newChild.removeListener('listening', onStarted);

        // immediately when replacement is ready and listening, stop the old worker
        // Once old worker closes all listened-on sockets, it will get no more requests,
        // but until then for a few ms both old and new worker are sent requests.
        //
        self.stopChild(oldChild, function(err) {
            if (err && !self.disconnectIfStop) {
                // if old child did not stop, let it run and clean up new child
                // However, if we already disconnected from the old child, keep the new.
                self.killChild(newChild, 'SIGKILL');
                return callback(err);
            }
            else return callback(null, newChild);
        })
    }
}

// hoist flow control messages into cluster events
QCluster._hoistMessageEvent = function hoistMessageEvent( target, m ) {
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
QCluster.prototype._hoistMessageEvent = QCluster._hoistMessageEvent;

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
        actions[ix++](function(err) { cb(err) });
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
                            qm.forkChild(function(err, child) {
                                forkCount += 1;
                                if (err) forkErrors.push(err);
                                // TODO: time out 'started' response
                                if (forkCount == options.clusterSize) {
                                    if (forkErrors.length) return cb(forkErrors[0]);
                                    for (var i=0; i<qm.children.length; i++) qcluster.sendTo(qm.children[i], 'start');
                                    // TODO: returns before workers have started listening
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

// export class methods as instance methods as well, else too confusing
QCluster.prototype.sendTo = QCluster.sendTo;
QCluster.prototype.sendToParent = QCluster.sendToParent;
QCluster.prototype.disconnectFrom = QCluster.disconnectFrom;
QCluster.prototype.disconnectFromParent = QCluster.disconnectFromParent;
QCluster.prototype.isQMessage = QCluster.isQMessage;

QCluster.prototype = QCluster.prototype;

module.exports = qcluster;
