'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({
    startedIfListening: true,
    stoppedIfDisconnect: true,
});

if (qcluster.isMaster) {
    var child = qm.forkChild(function(err, child) {
        console.log("child #%d started", child._pid);

        qcluster.sendTo(child, 'start');

        qm.stopChild(child, function(err) {
            console.log("child #%d stopped", child._pid);
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
