'use strict';

var qcluster = require('../');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster({ startTimeoutMs: 10 });
    // async returns the error
    qm.forkChild(function(err, child) {
        if (err) console.log("error: %s", err.message);
    })

    // sync returns the child process that gets killed on timeout
    var child = qm.forkChild();
    setTimeout(function() {
        console.log("child exists?", qm.existsProcess(child._pid));
        qcluster.delayExit();
    }, 100)
}
else {
    // note: timed out child processes are killed with SIGKILL, which breaks its coverage stats
    // so this "else" section appears not to have been run at all; this is not correct.
    console.log("child running, pid %d", process.pid);
    setTimeout(function() {
        qcluster.sendToParent('started');
    }, 2000);
    // wait for parent to kill us for not having started within 10ms
    setTimeout(process.exit, 1000);
}
