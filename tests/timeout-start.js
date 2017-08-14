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
console.log("AR: second child pid", child._pid);
        console.log("child exists?", qm.existsProcess(child._pid));
    }, 15)

    setTimeout(process.exit, 30);
}
else {
    console.log("child running, pid %d", process.pid);
    setTimeout(function() {
        qcluster.sendToParent('started');
    }, 20);
}
