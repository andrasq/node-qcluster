'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();
qm.handleSignals(runTest);

function runTest() {
    if (qcluster.isMaster) {
        var child = qm.forkChild();
        // verify that signal sent before child has started is queued and re-sent
        child.on('started', function() {
            setTimeout(function() {
                console.log("child exists?", qm.existsProcess(child._pid));
            }, 50);
            // TODO: race condition: 50ms maybe not enough for child to act on signal
        })

        // signal child before it finishes forking; parent should queue and relay
        setTimeout(function() {
            console.log("queued signal:", qm._signalsQueued[0]);
        }, 2);

        // the cluster master relays signals, is not killed by them
        process.kill(process.pid, 'SIGINT');
    }
    else {
        console.log("child running, pid %d", process.pid);
        process.once('SIGINT', function() {
            console.log("child SIGINT");
            setImmediate(process.exit);
        })
        qcluster.sendToParent('started');
    }
}
