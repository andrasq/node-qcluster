'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({
    startedIfListening: true,
    stoppedIfDisconnect: true,
});

qm.on('trace', console.log);

if (qcluster.isMaster) {
    var child = qm.forkChild(function(err, child) {
        console.log("child #%d started", child._pid);
        qcluster.sendTo(child, 'start');

        qm.replaceChild(child, function(err, child2) {
            console.log("child #%d stopped", child._pid);
            console.log("child2 #%d started", child2._pid);

            qm.stopChild(child2, function(err) {
                console.log("child2 stopped");
                //child2.disconnect();
            })
        })
    });

    child.on('ready', function() {
        console.log("child sent ready");
    })
    child.on('started', function() {
        console.log("child sent started");
    })
    child.on('stopped', function() {
        console.log("child sent stopped");
    })
    child.on('disconnect', function() {
        console.log("child disconnected");
    })
}
else {
    console.log("child running, pid %d", process.pid);

    // fake a net.createServer().listen
    qcluster.sendToParent('listening');

    process.on('start', function() {
        console.log("child got start");
    })
    process.on('stop', function() {
        console.log("child got stop");
        process.disconnect();
    })
}
