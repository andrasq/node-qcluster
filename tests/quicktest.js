'use strict';

var qcluster = require('../');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster();
    qm.handleSignals(function(){
        var child = qm.forkChild();
        child.on('started', function() {
            console.log("child started, pid %d", child.process.pid)
            qm.killChild(child);
        })
        qm.once('exit', function(child) {
            console.log("child exited, pid %d", child._pid);
            console.log("quicktest done, children.length: %d.", qm.children.length);
        })
    })
}
else {
    console.log("child running, pid %d", process.pid);
    qcluster.sendToParent('started');
    process.on('SIGTERM', function() {
        console.log("child killed, pid %d", process.pid);
        process.disconnect();
    })
}

// nb: 7 ms to run the quicktest??
