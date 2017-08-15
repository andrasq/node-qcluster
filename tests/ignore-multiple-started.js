'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var startedCount = 0;
    var child = qm.forkChild(function(err, child) {
        console.log("child started");
        setTimeout(process.exit, 100);
    })
    child.on('started', function() {
        startedCount += 1;
    })
    child.once('exit', function() {
        console.log("startedCount = %d", startedCount);
        qcluster._delayExit();
    });
}
else {
    qcluster.sendToParent('started');
    qcluster.sendToParent('started');
    qcluster.sendToParent('started');
    qcluster._delayExit();
}
