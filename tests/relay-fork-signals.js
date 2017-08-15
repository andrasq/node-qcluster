'use strict';

var qmock = require('qnit').qmock;
var qcluster = require('../');
var qm = qcluster.createCluster();
qm.handleSignals(runTest);

function runTest() {
    if (qcluster.isMaster) {
        var child = qm.forkChild();
        // verify that signal sent before child has started is queued and re-sent
        var spy = qmock.spyOnce(qm._signalsQueued, 'push');
        child.on('started', function() {
            spy.restore();
            console.log("queued signal: %s", spy.callArguments[0]);
            setTimeout(function() {
                console.log("child exists?", qm.existsProcess(child._pid));
            }, 50);
            // TODO: race condition: 50ms maybe not enough for child to act on signal
        })

        // the cluster master relays signals, is not killed by them
        process.kill(process.pid, 'SIGINT');
    }
    else {
        console.log("child running, pid %d", process.pid);
        process.once('SIGINT', function() {
            console.log("child SIGINT");
            qcluster._delayExit();
        })
        qcluster.sendToParent('started');
    }
}
