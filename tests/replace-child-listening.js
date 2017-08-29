'use strict';

var util = require('util');
var qcluster = require('../');
var qm = qcluster.createCluster({ disconnectIfStop: true });

qm.on('trace', function() {
//    console.log("trace: %s", util.inspect.apply(util, arguments));
})

if (qcluster.isMaster) {
    qm.forkChild(function(err, child1) {
        console.log("child1 pid %d", child1._pid);

        qm.replaceChild(child1, function(err, child2) {
            console.log("child2 pid %d", child2._pid);

            // after replace, expect child2 to be connected and child1 to not
            console.log("after replace, child1 connected =", child1.isConnected());
            console.log("after replace, child2 connected =", child2.isConnected());

            qm.stopChild(child2, function(){
                console.log("after stop, child2 connected =", child2.isConnected());
            })
        })
    })
}
else {
    console.log("child #%d running", process.pid);

    // pretend listen on a socket
    qcluster.sendToParent('listening');

    // child waits for 'disconnect' then exits
}
