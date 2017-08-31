'use strict';

var qcluster = require('../');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster({ clusterSize: 3, startedIfListening: true }, function(err) {
        console.log("cluster size =", qm.children.length);
        for (var i=0; i<qm.children.length; i++) console.log("child %d exists:", i+1, qm.existsProcess(qm.children[i]._pid));

        // to close the cluster, disconnect from all child processes
        for (var i=0; i<qm.children.length; i++) qm.children[i].disconnect();
    })
}
else {
    console.log("child #%d running", process.pid);
    qcluster.sendToParent('listening');
}
