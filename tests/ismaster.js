'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    console.log("pid #%d isMaster: %s, isWorker: %s", process.pid, qcluster.isMaster, qcluster.isWorker);
    var child = qm.forkChild();
    child.disconnect();
}
else {
    console.log("pid #%d isMaster: %s, isWorker: %s", process.pid, qcluster.isMaster, qcluster.isWorker);
}
