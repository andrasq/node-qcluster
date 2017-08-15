'use strict';

var qcluster = require('../');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster();
    var child = qm.forkChild();
    console.log("child exists: %s, pid %d", qm.existsProcess(child._pid), child._pid);
    child.on('started', function() {
        qm.killChild(child, 'SIGTERM');
        child.on('exit', function() {
            console.log("child gone: %s, pid %d", !qm.existsProcess(child._pid), child._pid);
            // NOTE: if child is killed -KILL, parent does not exit.  Force it.
            qcluster._delayExit();
        });
    })
}
else {
    console.log("child running, pid %d", process.pid);
    qcluster.sendToParent('started');
    qcluster._delayExit();
}
