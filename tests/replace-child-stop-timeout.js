'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    qm.forkChild(function(err, child1) {
        console.log("child1 pid %d", child1._pid);

        // force a stop timeout on child1, and do not let it exit
        qm.stopTimeoutMs = 1;
        qcluster.sendTo(child1, 'exitOnStop', false);

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
    // replaceChild requires the ready -> start -> started protocol
    qcluster.sendToParent('ready');
    process.on('start', function() {
        qcluster.sendToParent('started');
    })

    var exitOnStop = true;
    process.on('message', function(m) {
        if (qcluster.isQMessage(m) && m.n === 'exitOnStop') {
            exitOnStop = m.m;
        }
    })
    process.on('stop', function() {
        if (exitOnStop) process.disconnect();
    })
}
