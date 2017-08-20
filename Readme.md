qcluster
========

[![Build Status](https://api.travis-ci.org/andrasq/node-qcluster.svg?branch=master)](https://travis-ci.org/andrasq/node-qcluster?branch=master)
[![Coverage Status](https://codecov.io/github/andrasq/node-qcluster/coverage.svg?branch=master)](https://codecov.io/github/andrasq/node-qcluster?branch=master)

Robust worker cluster management.


## Summary

    const qcluster = require('qcluster');
    const master = qcluster.createCluster();

    var child = master.forkChild();


## Worker Start Protocol

QCluster uses a handshake protocol when starting and stopping worker processes:

To start:

- 'ready' - sent by child once child has finished initializing and is ready to accept
  requests (ie, is ready to listen).  The child may skip straight to 'started', or
  simply start listening for and serving requests, those also imply 'ready'.
- 'start' - sent by parent to a 'ready' child to tell it to start accepting requests
- 'started' - response sent by child to confirm that it is now accepting requests
- 'listening' - sent by nodejs to parent when child starts listening on a socket

To stop:

- 'stop' - sent by parent to stop child from accepting any more requests
- 'stopped' - response sent by child to confirm that it is not longer accepting
  requests.  The child may also exit, that also confirms that it stopped.
- 'quit' - sent by parent to tell child to exit
- 'exit' - sent by nodejs to parent after child process exited


## Signal Handling

The `options.signalsToRelay` signals are caught by the qcluster master and re-sent to
the worker processes.  Other signals are not treated as special.

Signals that arrive while a 

## API

### qm = qcluster.createCluster( [options,] [callback] )

Create a qcluster manager.

Options:

- startTimeoutMs - how long to allow a child process to become 'ready'.  Default 30000 ms.
- stopTimeoutMs - how long to allow a child process to take to stop.  Default 20000 ms.
- startedIfListening - whether to consider a 'listening' event equivalent to 'started.  Default true.
- signalsToRelay - which signals the master should catch and relay to the workers.  Default is
  [ 'SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2', 'SIGTSTP' ].  SIGTSTP is relayed as SIGSTOP.
- omitSignalHandler - do not catch or relay any signals to the workers.  Default false.
- clusterSize - number of worker processes to create when starting the cluster.

## IPC Messages

### qcluster.sendToParent( name, value )

Send a message to the parent process.  Startup flow control messages are converted
into process events, other messages arrive as process 'message' events.

The flow control messages were described above in Worker Start Protocol.

Other `sendToParent` messages are received by `process.on('message')` as the object

    { v: 'qc-1',
      pid: child.process.pid,
      n: name,
      m: value }

## Cluster Manager API

`createCluster` a qcluster manager object with properties and methods:

### qm.children

Array of worker processes.

### qm.forkChild( [callback] )

Add another child to the cluster, and start it.  Returns to the caller the child
process; returns to the callback the new child_process, or a "start timeout" error.

Child processes are automatically added to `qm.children` when they are forked.

Signals received by the qcluster master are stored and re-sent to the child after it
becomes ready.

### qm.stopChild( child, callback )

Send the child a 'stop' message, wait for it to acknowledge.  Can return a "stop
timeout" error.  A stopped child may exit, but at a minimum it must it must stop
listening for requests.

### qm.killChild( child, [signal] )

Send the given signal to the child.  The default signal is 'SIGTERM'.  Child processes
are automatically removed from `qm.children` when they exit.

### qm.replaceChild( child, callback )

Fork new child, wait for it to be ready, tell old child to stop, then when stopped
start new child.  Can return "start timeout" or "stop timeout" errors.

This sequence ensures that a service with a single worker always remains strictly
single-threaded.  The gap in service is minimized to just the 'start' and 'stop'
handshakes, worker initialization and shutdown are gracefully overlapped.

Child processes are replaced sequentially, one at a time.  Multiple requests are
queued and processed in order of arrival.  If there is a fork error, start timeout or
stop timeout, the new process is killed and the old process is left to run.

## Todo

- rename `forkChild` -> `startChild`
