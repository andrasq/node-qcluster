'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({
    startedIfListening: true,
    disconnectIfStop: true,
});

if (qcluster.isMaster) {
    qm.forkChild(function(err, child) {
        console.log("parent got child");
        child.disconnect();
    })
}
else {
    console.log("child running, pid #%d", process.pid);
    qcluster.sendToParent('listening');

    process.on('start', function() {
        console.log("child got start");
    })

    process.on('stop', function() {
        console.log("child got stop");
    })

    process.on('disconnect', function() {
        console.log("child got disconnect");
    })
}
