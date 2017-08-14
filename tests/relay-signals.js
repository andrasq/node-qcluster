'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();
qm.handleSignals(runTest);

function runTest() {
    if (qcluster.isMaster) {
        var child = qm.forkChild();
        child.on('ready', function() {
            // no rights to send signal to process 1 (init), error should be ignored
            qm.children.push({ _pid: 1 });

            // the cluster master relays signals, is not killed by them
            process.kill(process.pid, 'SIGINT');

            // verify that signal send after child has started is received by child
            setTimeout(function() {
                console.log("child exists?", qm.existsProcess(child._pid));
                setImmediate(process.exit)
            }, 50);
            // TODO: race condition: 50ms maybe not enough for child to act on signal
        })
    }
    else {
        qcluster.sendToParent('started');
        // use a spurious (out of sequence) 'ready' to strobe parent test
        qcluster.sendToParent('ready');
        console.log("child running, pid %d", process.pid);
        process.once('SIGINT', function() {
            console.log("child SIGINT");
            setTimeout(process.exit, 2);
        })
    }
}
