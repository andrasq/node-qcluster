'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var child = qm.forkChild({}, function() {
        qm.killChild(child, 'SIGINT');
        qm.killChild(child);
    })
}
else {
    process.on('SIGINT', function() {
        console.log("child process SIGINT");
    })
    process.on('SIGTERM', function() {
        console.log("child process SIGTERM");
        setTimeout(process.exit, 2);
    })
    qcluster.sendToParent('started');
}
