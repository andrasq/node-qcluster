'use strict';

var qmock = require('qnit').qmock;
var qcluster = require('../');
var qm = qcluster.createCluster();
qm.handleSignals(runTest);

function runTest() {
    if (qcluster.isMaster) {
        var child = qm.forkChild();
        child.on('started', function() {
            var spy = qmock.spy(process, 'kill');

            // if master is killed with SIGTSTP, it should suspend the children
            process.kill(process.pid, 'SIGTSTP');

            setTimeout(function() {
                console.log("callCount = %d", spy.callCount);
                console.log("signal =", spy.callArguments[1]);
                // note: if the master exits, execSync() still does not return until child finishes too.
                // note: if the master exits, it still lets the child finish before exec() returns
                setImmediate(process.exit);
            }, 0)
        })
    }
    else {
        qcluster.sendToParent('started');
        setImmediate(process.exit);
    }
}
