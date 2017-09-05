'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster({
    startedIfListening: false,
    disconnectIfStop: false,
});

qm.on('trace', console.log);

if (qcluster.isMaster) {
    qm.forkChild(function(err, child) {
        qcluster.sendTo(child, 'stop');
        child.on('stopped', function() {
            qcluster.disconnectFrom(child);
        })
    })
}
else {
    console.log("child running, pid #%d", process.pid);
    qcluster.sendToParent('ready');
    process.on('start', function() {
        console.log("child got start");
        qcluster.sendToParent('listening');
        setTimeout(function() { qcluster.sendToParent('started') }, 50);
    })
    process.on('stop', function() {
        console.log("child got stop");
        qcluster.sendToParent('stopped');
    })
}
