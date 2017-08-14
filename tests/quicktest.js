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
        qm.once('quit', function(child) {
            console.log("child quit, pid %d", child._pid);
            if (!qm.children.length) {
                console.log("quicktest done.");
            }
        })
    })
    // wait 1 tick to allow the signals to fire and the test to run
    setTimeout(function(){}, 1);
}
else {
    console.log("child running, pid %d", process.pid);
    qcluster.sendToParent('started');
    process.on('SIGTERM', function() {
        console.log("child killed, pid %d", process.pid);
        setImmediate(process.exit);
    })
}

// nb: 7 ms to run the quicktest??
