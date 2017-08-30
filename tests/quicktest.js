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
        child.once('stopped', function() {
            console.log("child sent 'stopped'")
        })
        qm.once('exit', function(child) {
            console.log("child exited, pid %d", child._pid);
            console.log("quicktest done, children.length: %d.", qm.children.length);
        })
    })
}
else {
    console.log("child running, pid %d", process.pid);
    process.on('SIGTERM', function() {
        qcluster.sendToParent('stopped');
        console.log("child killed, pid %d", process.pid);
        setTimeout(function() {
            process.disconnect();
            // there is a race condition between the child and the parent
            // where sometimes the console.log form the sig handler is lost
            // qcluster._delayExit(10);
        }, 100);
    })
    qcluster.sendToParent('started');
}

// nb: 7 ms to run the quicktest??
