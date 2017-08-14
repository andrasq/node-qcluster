'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var child = qm.forkChild();
    if (qm.existsProcess(child._pid)) console.log("child exists, pid %d", child._pid);
    child.on('started', function() {
        qm.killChild(child, 'SIGKILL');
        setTimeout(function() {
            if (!qm.existsProcess(child._pid)) console.log("child gone, pid %d", child._pid);
            // NOTE: if child is killed -KILL, parent does not exit.  Force it.
            process.exit();
        }, 10);
    })
}
else {
    console.log("child running, pid %d", process.pid);
    qcluster.sendToParent('started');
    setTimeout(process.exit, 1000);
}
