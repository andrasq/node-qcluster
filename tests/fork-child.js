'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    qm.forkChild();
}
else {
    console.log(process.pid + " child process running.");
    qcluster.sendToParent('started');
    setTimeout(process.exit, 2);
}
