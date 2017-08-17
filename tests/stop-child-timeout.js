'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({ stopTimeoutMs: 10 });

if (qcluster.isMaster) {
    var child = qm.forkChild();
    child.on('started', function() {
        qm.stopChild(child, function(err) {
            console.log("child err: %s", err.message);
            qcluster._delayExit();
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
        }, 200);
    })
}
