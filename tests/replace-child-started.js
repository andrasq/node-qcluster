'use strict';

var util = require('util');
var qcluster = require('../');
var qm = qcluster.createCluster({
    startedIfListening: false,
    disconnectIfStop: false,
    stoppedIfDisconnect: false,
});

qm.on('trace', function() {
//    console.log("trace: %s", util.inspect.apply(util, arguments));
})

if (qcluster.isMaster) {
    qm.forkChild(function(err, child1) {
        console.log("child1 pid %d", child1._pid);

        // with the 'stop' -> 'stopped' protocol the child.suicide does
        // not indicate whether the child is connected, and stopChild()
        // does not consider 'disconnect' to be stopped.

        var child1Stopped = false;
        child1.on('stopped', function() { child1Stopped = true });

        qm.replaceChild(child1, function(err, child2) {
            console.log("child2 pid %d", child2._pid);

            // after replace, expect child2 to be connected and child1 to not
            console.log("after replace, child1 connected =", !child1Stopped);
            console.log("after replace, child2 connected =", !child2.suicide);

            var child2Stopped = false;
            child2.on('stopped', function() { child2Stopped = true });

            qm.stopChild(child2, function(){
                console.log("after stop, child2 connected =", !child2Stopped);
            })
        })
    })
}
else {
    console.log("child #%d running", process.pid);

    // pretend listen on a socket
    qcluster.sendToParent('started');

    process.on('stop', function() {
        qcluster.sendToParent('stopped');
        process.disconnect();
    })
}
