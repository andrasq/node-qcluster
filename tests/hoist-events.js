'use strict';

var qcluster = require('../');
var qm = qcluster.createCluster();

if (qcluster.isMaster) {
    var child = qm.forkChild();

    child.on('ready', function() {
        console.log("parent: got ready");
        qcluster.sendTo(child, 'start');

        // should not hoist non-qcluster messages
        child.send({ n: 'other', m: 'other' });
    });
    child.on('listening', function() {
        console.log("parent: got listening");
    })
    child.on('started', function() {
        console.log("parent: got started");
        qcluster.sendTo(child, 'stop');
    })
    child.on('stopped', function() {
        console.log("parent: got stopped");
        qcluster.sendTo(child, 'quit');
    })
    child.on('other', function() {
        console.log("parent: got other");
    })
    child.on('message', function(m) {
        console.log("parent: got message: %s", m.n);
    })
    child.on('exit', function() {
        console.log("parent: child exited");
        qcluster._delayExit();
    })
}
else {
    qcluster.sendToParent('ready');
    qcluster.sendToParent('listening');
    qcluster.sendToParent('status', 'ok');
    process.once('start', function() {
        console.log("child: got start");
        qcluster.sendToParent('started');
    })
    process.once('stop', function() {
        console.log("child: got stop");
        qcluster.sendToParent('stopped');
    })
    process.once('quit', function() {
        console.log("child: got quit");
        qcluster._delayExit();
    })
    process.once('other', function() {
        console.log("child: got other");
    })

    // should not hoist invalid messages
    process.send({ n: 'other', m: 'other' });

    // wait for 'quit'
    qcluster._delayExit(999999);
}
