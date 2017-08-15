'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({ startTimeoutMs: 10 });

if (qcluster.isMaster) {
    // async returns the error
    qm.forkChild(function(err, child) {
        if (err) console.log("error: %s", err.message);
    })

    // sync returns the child process that gets killed on timeout
    var child = qm.forkChild();
    setTimeout(function() {
        console.log("child exists?", qm.existsProcess(child._pid));
        qcluster.delayExit();
    }, 40)
}
else {
    console.log("child running, pid %d", process.pid);
    setTimeout(function() {
        qcluster.sendToParent('started');
    }, 20);
    // wait for parent to kill us for not having started within 10ms
    setTimeout(process.exit, 1000);
}
