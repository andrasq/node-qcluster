'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var child = qm.forkChild(function(err, child) {
        console.log('startChild callback, err:', err.message);
    });
    child.on('exit', function(code) {
        console.log('child exited, code ' + code);
    })
    child.on('started', function() {
        console.log('child started');
    })
}
else {
    // child dies before starting, parent should trea it as error
    process.exit(123);
}
