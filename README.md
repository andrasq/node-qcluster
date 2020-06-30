qcluster
========

[![Build Status](https://api.travis-ci.org/andrasq/node-qcluster.svg?branch=master)](https://travis-ci.org/andrasq/node-qcluster?branch=master)
[![Coverage Status](https://codecov.io/github/andrasq/node-qcluster/coverage.svg?branch=master)](https://codecov.io/github/andrasq/node-qcluster?branch=master)

Robust work cluster management.

Qcluster is a wrapper around the nodejs `cluster` module to help more seamlessly
manage a work cluster.  It propagates signals, can start and stop workers, and can
selectively replace workers without dropping requests.


Sample parent:

    const qcluster = require('qcluster');
    const qm = qcluster.createCluster();

    if (qcluster.isMaster) {
        qm.forkChild(function(err, child) {
            // child forked, ready to serve requests

            child.on('message', function(message) {
                if (qcluster.isQMessage(message)) {
                    console.log("child #%d sent", message.pid, message);
                }
            })

            // tell child to start serving requests
            qcluster.sendTo(child, 'start');
            child.once('started', function() {
                // child serving requests
            })

            // ...

            // tell child to stop serving requests
            qcluster.sendTo(child, 'stop');

            child.once('stopped', function() {
                // child stopped running requests, disconnect to let it exit
                child.disconnect();
            })

            // alternately, replace a running child
            qm.replaceChild(child, function(err, child2) {
                // child stopped, now child2 serving requests
            })
        })
    }

Sample child:

    if (!qcluster.isMaster) {
        createApp(function(err, app) {
            qcluster.sendToParent('ready');

            process.on('start', function() {
                app.listen();
                qcluster.sendToParent('started');
            })

            process.on('stop', function() {
                app.close();
                qcluster.sendToParent('stopped');
            })
        })
    }


## Worker Start Protocol

QCluster uses a handshake protocol when starting and stopping worker processes:

Starting:

- 'ready' - sent by child once child has finished initializing and is ready to accept
  requests (ie, is ready to listen).  The child may skip straight to 'started', or
  simply start listening for and serving requests, those also imply 'ready'.
- 'start' - sent by parent to a 'ready' child to tell it to start accepting requests
- 'started' - response sent by child to confirm that it is now accepting requests
- 'listening' - sent by nodejs to parent when child starts listening on a socket

Stopping:

- 'stop' - sent by parent to stop child from accepting any more requests
- 'stopped' - response sent by child to confirm that it is not longer accepting
  requests.  The child may also exit, that also confirms that it stopped.
- 'exit' - sent by nodejs to parent after child process exited

QCluster also supports the minimal nodejs `cluster` startup protocol.

Starting:

- 'listening' - sent by child as soon at it listens for requests over the network.
  This is built into the `net` module when running in `cluster` mode.

Stopping:

- 'disconnect' - notification received that the other side has disconnected, closed
  the IPC channel, and that the child will not be receiving more requests.  Once
  disconnected, the child can no longer send messages to the master.


## API

### qm = qcluster.createCluster( [options,] [callback] )

Create a qcluster manager.

Options:

- startTimeoutMs - how long to allow a child process to become 'ready'.  Default 30000 ms.
- stopTimeoutMs - how long to allow a child process to take to stop.  Default 20000 ms.
- startedIfListening - whether to consider a 'listening' event equivalent to 'started.  Default true.
- disconnectIfStop - when stopping a child, whether to also disconnect() after sending 'stop'.
  Default false.
- stoppedIfDisconnect - when waiting for a child to stop, whether to treat a 'disconnect'
  as meaning 'stopped'.  Default true.
- signalsToRelay - which signals the master should catch and relay to the workers.  Default is
  [ 'SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2', 'SIGTSTP', 'SIGCONT' ].
  SIGTSTP handling is special; see Signal Handling below.
- omitSignalHandler - do not catch or relay any signals to the workers.  Default false.
- clusterSize - number of worker processes to create when starting the cluster.  Default none.


## Qcluster manager properties:

### qm.children

Array of worker processes.


## Qcluster manager events:

The qcluster manager emits certain events connected to worker process management.

- 'fork' - when a new worker process is forked
- 'exit' - when a worker process exits
- 'trace' - on worker process management actions.  The arguments consist of a format
  string and parameters, suitable for passing to `util.format` or `console.log` or
  `sprintf`

## Qcluster manager methods:

### qm.forkChild( [callback] )

Add another child to the cluster, and start it.  Returns to the caller the child
process; calls the callback with the new child_process after it started, or on "unable
to fork" or "start timeout" error.

If unable to fork, `qm` emits an `'error'` event, which if not listened for will be
rethrown by nodejs as an exception.

Child processes are automatically added to `qm.children` when they are forked.

Signals received by the qcluster master are stored and re-sent to the child after it
becomes ready.

### qm.findPid( pid )

Return the child from among `qm.children` with the given process id `pid`.

### qm.stopChild( child, callback )

Send the child a 'stop' message, wait for it to acknowledge.  Can return a "stop
timeout" error.  A stopped child may exit, but at a minimum it must it must stop
listening for requests.

### qm.killChild( child, [signal] )

Send the given signal to the child.  The default signal is 'SIGTERM'.  Child processes
are automatically removed from `qm.children` when they exit.

### qm.replaceChild( child, callback )

Fork new child, wait for it to be ready, tell old child to stop, then when stopped
start new child.  Can return "start timeout", "stop timeout" or "already being
replaced" errors.

This sequence ensures that a service with a single worker always remains strictly
single-threaded.  The gap in service is minimized to just the 'start' and 'stop'
handshakes, worker initialization and shutdown are gracefully overlapped.

Child processes are replaced sequentially, one at a time.  Multiple requests are
queued and processed in order of arrival.  If there is a fork error, start timeout or
stop timeout, the new process is killed and the old process is left to run.

### qm.isBeingReplaced( child )

Check whether the child is already queued for replacement.  A child may be replaced
only once.

### qm.cancelReplace( child )

Cancel any pending replacement for the child.  A replacement already in progress is
not interrupted.


## Signal Handling

The `options.signalsToRelay` signals are caught by the qcluster master and re-sent to
the worker processes.  Other signals are not treated as special.  The re-sent signals
are ignored; other signals may kill the master.  'SIGSTOP' and 'SIGKILL' cannot be caught,
and it is a nodejs error to try.

A received SIGTSTP is converted to SIGSTOP and after relaying is resent to self to
pause both worker processes and self.  The next SIGCONT will resume self, and is
relayed to all worker processes to resume them.

Signals that arrive while a process is paused are stored by the system and will not be
relayed until after a SIGCONT first resumes the master.  The relayed signal is sent to
the still paused workers before the SIGCONT, so signal delivery order is maintained.

Signals that arrive while a worker is initializing are queued and re-sent after the
worker is 'ready', letting the worker handle the signal without killing the
half-initialized process.  This includes 'SIGTSTP', ie an initializing worker will not
be suspended at the same time as the other workers.


## Qcluster IPC messages:

### qcluster.sendTo( child, name, value )

Send a message to a worker process.  The message can be received in the worker with
`process.on('message')` and tested with `qcluster.isQMessage()`.

### qcluster.sendToParent( name, value )

Send a message to the parent process.  Startup flow control messages are converted
into process events, other messages arrive as process 'message' events.

### qcluster.isQMessage( message )

Tests that the message was sent with `sendToParent`.


## IPC Message Details

The flow control events were described above in Worker Start Protocol.  In the parent,
flow control messages are re-emitted as `child` object events; in the child, as
`process` events.

Other, non-flow-control `sendToParent` messages are received by the cluster master
with the usual nodejs `cluster` IPC: `child.on('message')` or `cluster.on('message')`.
The message format is

    { v: 'qc-1',
      pid: child.process.pid,
      n: name,
      m: value }


## Nodejs Cluster Notes

- The cluster master listens on the service socket, accepts connections, and sends a
  message to one of the workers to invoke the request handler.  This magic is hidden
  inside the `net` module.

- Listening to 'disconnect' or 'message' worker events `ref`-s the IPC channel and
  prevents the child process from exiting until disconnect.

- The cluster master process will not exit until all worker processes have exited
  or disconnected.

- A cluster worker will start receiving requests (forwarded by the master) as soon as
  it listens on *any* connection.  If a service listens for requests on port 80 and
  for status queries on port 1337, it will be sent requests as soon as it starts
  listening on either port.

- A cluster worker keeps getting requests as long as it is listening on *any*
  connection.  If the above server closes port 80, it will still get requests as long
  as port 1337 is still open.

- If no workers are listening, incoming requests get an ECONNREFUSED error (node-v0.10
  just hangs).  Stopping one worker before its replacement is listening opens a race
  condition window during which requests would not be served.

- If a worker disconnects before it has finished processing all requests, some calls
  could be lost.  To shut down cleanly, it should close its listened-on socket to stop
  receiving more calls, finish processing all pending requests, and only then exit.


## Change Log

- 0.8.4 - cleanups, omit tests from npm package

- 0.8.2 - make replaceChild tolerate no callback, make stopChild tolerate an already exited
          process
- 0.8.0 - make startChild / forkChild wait for the process to be ready to serve requests
          before returning

## Todo

- rename `forkChild` -> `startChild`
- support trace events of qcluster actions, eg pre-fork, post-fork, pre-replace,
  signal relay, etc.
