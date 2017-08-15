'use strict';

var qmock = require('qnit').qmock;
var qcluster = require('../');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster();
    qm.handleSignals(function() {
        var child = qm.forkChild();
        child.on('started', function() {
            var spy = qmock.spy(process, 'kill');

            // if master is killed with SIGTSTP, it should suspend the children
            process.kill(process.pid, 'SIGTSTP');

            setTimeout(function() {
                spy.restore();
                process.kill(process.pid, 'SIGCONT');
                console.log("callCount = %d", spy.callCount);
                console.log("signal =", spy.callArguments[1]);

                // note: from the cmdline, the child gets a 'disconnect' event on parent exit,
                // which invokes process.exit().  From the unit tests, there is no disconnect,
                // and exec() hangs until the test suite exits.  The child process.exit() also fails to run.
                // Work around this by explicitly killing the child process.
                setTimeout(function() {
                    process.kill(child._pid, 'SIGKILL');
                    process.exit();
                }, 1)
            }, 10)
            // note: if the child exits too soon, the SIGCONT will not find it in qm.children[]
        })
    })
}
else {
    qcluster.sendToParent('started');
    qcluster._delayExit();
}
