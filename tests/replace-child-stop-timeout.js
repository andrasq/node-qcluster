'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    qm.forkChild(function(err, child1) {
        console.log("child1 pid %d", child1._pid);
        // force a stop timeout
        qm.stopTimeoutMs = 1;
        qm.replaceChild(child1, function(err, child2) {
            console.log("child2 replace error: %s", !!err);
            if (err) console.log("replace error: %s", err.message);
            qm.on('exit', function(child) {
                console.log("still have child1: %s", (qm.children.length > 0 && qm.children[0]._pid === child1._pid));
                if (child != child1) {
                    console.log("child2 exited");
                    child1.disconnect();
                }
            })
        })
    })
}
else {
    qcluster.sendToParent('started');
}
