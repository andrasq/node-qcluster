'use strict';

var qmock = require('qnit').qmock;
var qcluster = require('../');
var child_process = require('child_process');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster();
    console.log("parent pid %d", process.pid);
    qm.handleSignals(function() {
        var child = qm.forkChild();
        child.on('started', function() {
            var spy = qmock.spy(process, 'kill');

            // arrange for wakeup after 0.100 sec
            child_process.exec("sleep 0.100 ; kill -CONT " + process.pid, function(err, stdout, stderr) {
                if (err) throw err;
            });

            // suspend child processes then suspend self
            process.kill(process.pid, 'SIGTSTP');

            child.on('exit', function() {
                // call count: child STOP + self STOP + child CONT (self CONT is from wakeup)
                console.log("callCount = %d", spy.callCount);
                console.log("signal1 =", spy.args[0][1]);       // test TSTP
                console.log("signal2 =", spy.args[1][1]);       // child STOP
                console.log("signal3 =", spy.args[2][1]);       // self STOP
                console.log("signal4 =", spy.args[3][1]);       // child CONT

                // note: from the cmdline, the child gets a 'disconnect' event on parent exit,
                // which invokes process.exit().  From the unit tests, there is no disconnect,
                // and exec() hangs until the test suite exits.  The child process.exit() also fails to run.
                // Work around this by explicitly killing the child process.
                child.disconnect();
                qcluster._delayExit();
            })
            // note: if the child exits too soon, the SIGCONT will not find it in qm.children[]
        })
    })
}
else {
    qcluster.sendToParent('started');
    console.log("child pid %d", process.pid);
    process.on('SIGTSTP', function() {
        console.log("child SIGTSTP");
    })
    process.on('SIGCONT', function() {
        console.log("child SIGCONT");
        qcluster._delayExit();
    })
}
