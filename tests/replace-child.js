'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({ stopTimeoutMs: 200 });

if (qcluster.isMaster) {
    qm.forkChild(function(err, child1) {
        console.log("children before replace length = %d", qm.children.length);
        if (qm.children[0]) console.log("children before replace pid %d", qm.children[0]._pid);
        console.log("child1 pid %d", child1._pid);
        qm.replaceChild(child1, function(err, child2) {
            console.log("child2 pid %d", child2._pid);
            console.log("pids differ " + (child1._pid !== child2._pid));
            child1.on('exit', function() {
                console.log("children after replace length = %d", qm.children.length);
                if (qm.children[0]) console.log("children after replace pid %d", qm.children[0]._pid);
                // the parent does not exit while connected child is running
                qcluster.sendTo(child2, 'stop');
            })
        })
    })
}
else {
    // replaceChild workers must implement the 'ready' -> 'start' -> 'started' protocol
    qcluster.sendToParent('ready');
    process.on('start', function() {
        qcluster.sendToParent('started');
    })
    // replaceChild workers must implement the 'stop' -> 'stopped' protocol
    process.on('stop', function() {
        qcluster.sendToParent('stopped');
        qcluster._delayExit(20);
    })
}
