'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var child = qm.forkChild();
    child.on('stopped', function() {
        console.log("child says stopped");
    })
    child.on('started', function() {
        qm.stopChild(child, function(err) {
            console.log("child stopped");
            qcluster._delayExit();
        })
    })
}
else {
    console.log("child running, pid %d", process.pid);
    qcluster.sendToParent('started');
    process.on('stop', function() {
        console.log("child received stop, pid %d", process.pid);
        qcluster.sendToParent('stopped');
        // should ignore a second 'stopped'
        qcluster.sendToParent('stopped');
    })
}
