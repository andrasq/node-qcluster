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
        // note: using disconnect() does not ensure that the "child killed" is written to stdout.
        // delay the exit explicitly to work around this.
        qcluster._delayExit(10);
    })
}

// nb: 7 ms to run the quicktest??
