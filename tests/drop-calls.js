/*
 * test that none in a stream of back-to-back requests is dropped when
 * the worker server is replaced.  The parent makes the requests, the child
 * runs the service that processes them and responds.
 *
 * Copyright (C) 2017 Andras Radics
 */

'use strict';

var net = require('net');
var qcluster = require('../');

if (qcluster.isMaster) {
    var qm = qcluster.createCluster({
        startedIfListening: true,
        // disconnectIfStop: true,
        // TODO: protocol: 'listening'
    })

    qm.on('trace', console.log);

    qm.forkChild(function(err, child) {
        var ncalls = 0, ndone = 0, doStop = false;
        var childCalls = {};
        var callPids = [];
        var receivedCalls = [];

        // make lots of calls to the service until told to stop
        setImmediate(function pingLoop() {
            var socket = net.connect(13337);

console.log("P sending", ncalls);
            socket.write(String(ncalls));
            socket.end();
            ncalls += 1;

            // NOTE: sometimes nodejs sends a call to the newly forked process before its
            // 'listening' event has arrived; it eventually receives and runs the call.

            // NOTE: without disconnectIfStop nodejs can send a call to a worker that has
            // already closed and disconnected but whose 'disconnect' message has not arrived.
            // This call is lost.  The workaround is for the child disconnect later, first
            // just close its server to notify the parent to stop sending it calls.

            socket.on('data', function(chunk) {
                // the worker returns its pid followed by the sent call sequence number
                chunk = chunk.toString();
console.log("P got", chunk);
                var pid = parseInt(chunk);
                var callNum = parseInt(chunk.split(' ')[1]);
                callPids.push(chunk);
                receivedCalls[callNum] = chunk;
                childCalls[pid] = childCalls[pid] ? childCalls[pid] + 1 : 1;
                ndone += 1;
            })

            socket.on('error', function(err) {
                console.log("parent: socket ERROR", err.message);
            })

            if (!doStop) setImmediate(pingLoop);
            else console.log("pingLoop stop");
        })

        process.on('SIGINT', process.exit);

        // once a bunch of calls have been made, swap workers
        setTimeout(function() {
            qm.replaceChild(qm.children[0], function(err, child2) {

                // after another bunch of calls, stop making calls
                setTimeout(function() {
                    doStop = true;

                    // quit after the pending calls have had time to finish
                    // TODO: should automatically close connections once all replies have arrived,
                    // but keep getting ECONNRESET timing race conditions
                    setTimeout(function() {
                        var child1Calls = childCalls[child._pid];
                        var child2Calls = childCalls[child2._pid];
                        for (var i=0; i<ncalls; i++) if (!receivedCalls[i]) console.log("missing call %d", i);
                        console.log("parent ncalls = %d", ncalls);
                        console.log("parent ndone = %d", ndone);
                        console.log("ncalls == ndone ?", ncalls == ndone);                              // all calls were replied to
                        console.log("child1 calls > 10 ? %s (%d)", child1Calls > 10, child1Calls);      // child1 ran calls
                        console.log("child2 calls > 10 ? %s (%d)", child1Calls > 10, child2Calls);      // child2 ran calls
                        qm.stopChild(child2, function() {
                            // wait for the workers to exit, then exit ourselves
                            // workers exit once they have finished sending the replies
                            // TODO: should not have to forcibly exit the process, find why
                            qcluster._delayExit(10);
                        })
                    }, 250)
                }, 5)
            })
        }, 10);
    })
}
else {
    // create a simple echo server
    var server = net.createServer({ allowHalfOpen: true }).listen(13337);
    var ncalls = 0;
    var minCall = Infinity, maxCall = -1;

    console.log("child server running");
    server.on('connection', function(socket) {
        socket.on('data', function(chunk) {
            // echo back the received data
            var callValue = parseInt(chunk);
            socket.write(String(process.pid) + ' ' + callValue);
console.log("C %d got %d", process.pid, callValue);
            if (callValue < minCall) minCall = callValue;
            if (callValue > maxCall) maxCall = callValue;
            ncalls += 1;
        })
        socket.on('error', function(err) {
            console.log("child #%d: socket ERROR:", process.pid, err.message);
            //throw err;
        })
    })

    process.on('stop', function() {
        server.close();
        qcluster.sendToParent('stopped');
        console.log("stop: child ncalls %d (#%d, %d - %d)", ncalls, process.pid, minCall, maxCall);
        // do not disconnect, to be sure parent knows to not send us any more requests.  let parent close child.
    })

    process.on('disconnect', function() {
        server.close();
        qcluster.sendToParent('stopped');
        console.log("disconnect: child ncalls %d (#%d, %d - %d)", ncalls, process.pid, minCall, maxCall);
    })

    process.on('uncaughtException', function(err) {
        console.log("child #%d: uncaught exception:", process.pid, err.message);
        process.exit(1);
    })
}
