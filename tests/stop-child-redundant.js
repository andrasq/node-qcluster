'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var child = qm.forkChild();
    var stopCount = 0;
    child.on('stopped', function() {
        stopCount += 1;
    })
    child.on('started', function() {
        qm.stopChild(child, function(err) {
            console.log("child stopped count %d", stopCount);
            qcluster._delayExit(20);
        })
    })
}
else {
    console.log("child running");
    qcluster.sendToParent('started');
    process.on('stop', function() {
        console.log("child received stop");
        setTimeout(function() {
            qcluster.sendToParent('stopped');
            qcluster.sendToParent('stopped');
            qcluster.sendToParent('stopped');
        }, 100);
    })
}
