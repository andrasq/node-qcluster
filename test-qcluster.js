'use strict';

var assert = require('assert');
var child_process = require('child_process');
var cluster = require('cluster');
var fs = require('fs');

var qcluster = require('./');

// each createCluster() adds a listener on process, allow for it in the tests
process.setMaxListeners(100);

module.exports = {

    'should export createCluster': function(t) {
        assert.equal(typeof qcluster.createCluster, 'function');
        t.done();
    },

    'should export isMaster': function(t) {
        assert.strictEqual(qcluster.isMaster, true);
        assert.strictEqual(qcluster.isWorker, false);
        t.done();
    },

    'should export sendTo, sendToParent': function(t) {
        assert.equal(typeof qcluster.sendTo, 'function');
        assert.equal(qcluster.sendTo.length, 3);
        assert.equal(typeof qcluster.sendToParent, 'function');
        assert.equal(qcluster.sendToParent.length, 2);
        t.done();
    },

    'should provide log that bypasses stdout': function(t) {
        var spy = t.stubOnce(fs, 'writeFileSync');
        qcluster.log("test message %d", 123);
        t.equal(spy.callCount, 1);
        t.deepEqual(spy.callArguments, [ '/dev/tty', 'test message 123\n', { flag: 'a' } ]);
        t.done();
    },

    'createCluster': {
        'should create QCluster object': function(t) {
            var q = qcluster.createCluster();
            assert(q instanceof qcluster.QCluster);
            t.done();
        },

        'should accept options': function(t) {
            var q = qcluster.createCluster();
            var q2 = qcluster.createCluster({
                startTimeoutMs: 11,
                stopTimeoutMs: 22,
            })
            assert(q.startTimeoutMs > 0);
            assert(q.stopTimeoutMs > 0);
            assert.equal(q2.startTimeoutMs, 11);
            assert.equal(q2.stopTimeoutMs, 22);
            t.done();
        }
    },

    'sendTo': {
        beforeEach: function(done) {
            this.q = qcluster.createCluster();
            done();
        },

        'should returns send errors': function(t) {
            var target = { send: function() { throw new Error('test error') } };
            var ret = qcluster.sendTo(target, 'name', 'value');
            assert(ret instanceof Error);
            t.done();
        },
    },

    'sendToParent': {
        'should invoke sendTo with process': function(t) {
            var spy = t.stubOnce(qcluster, 'sendTo');
            qcluster.sendToParent('name', 'value');
            assert.strictEqual(spy.called, true);
            assert.deepEqual(spy.callArguments[0], process);
            t.contains(spy.callArguments, ['name', 'value']);
            t.done();
        },

        'should invoke process.send': function(t) {
            var spy = t.stubOnce(process, 'send');
            qcluster.sendToParent('name', 'value');
            t.done();
        },
    },

    'findPid': {
        'should return child with pid': function(t) {
            var qm = qcluster.createCluster();
            var child = { _pid: 1 };
            qm.children.push(child);
            t.strictEqual(qm.findPid(1), child);
            t.done();
        },

        'should return undefined if pid not found': function(t) {
            var qm = qcluster.createCluster();
            var child = { _pid: 1 };
            qm.children.push(child);
            t.equal(qm.findPid(2), undefined);
            t.done();
        },
    },

    '_removePid': {
        'should remove child from children': function(t) {
            var qm = qcluster.createCluster();
            var array1 = qm.children;
            qm.children.push({ _pid: 1 });
            qm.children.push({ _pid: 2 });
            qm.children.push({ _pid: 3 });
            qm._removePid(2);
            var array2 = qm.children;
            t.equal(array1, array2);
            t.equal(qm.children.length, 2);
            t.equal(qm.children[0]._pid, 1);
            t.equal(qm.children[1]._pid, 3);
            t.done();
        },
    },

    'forkChild': {
        'should use cluster.fork': function(t) {
            var spy = t.stubOnce(cluster, 'fork', function(){ return mockChild() });
            var child = qcluster.createCluster().forkChild();
            t.equal(spy.callCount, 1);
            t.equal(child._pid, 12345678);
            t.done();
        },

        'should add to children': function(t) {
            var spy = t.stubOnce(cluster, 'fork', function() { return mockChild() });
            var self = this;
            var qm = qcluster.createCluster();
            var child = qm.forkChild();
            t.ok(child._pid === 12345678);
            t.ok(qm.children[0] === child);
            t.ok(qm.findPid(child._pid) === child);
            t.done();
        },

        'should invoke startChild': function(t) {
            var qm = qcluster.createCluster();
            var spyFork = t.stubOnce(cluster, 'fork', function(){ return mockChild() });
            var spyStartChild = t.stubOnce(qm, 'startChild');
            var child = qm.forkChild();
            t.equal(spyStartChild.callCount, 1);
            t.equal(spyStartChild.callArguments[0], child);
            t.done();
        },

        'errors': {
            'should throw Error on sync fork error': function(t) {
                var qm = qcluster.createCluster();
                var spy = t.stubOnce(cluster, 'fork', function() { return null });
                try {
                    var child = qm.forkChild();
                }
                catch (err) {
                    t.contains(err.message, 'unable to fork');
                    t.done();
                }
            },

            'should return Error on async fork error': function(t) {
                var qm = qcluster.createCluster();
                var spy = t.stubOnce(cluster, 'fork', function(){ return null });
                qm.forkChild(function(err, child) {
                    t.ok(err);
                    t.contains(err.message, 'unable to fork');
                    t.done();
                })
            },
        },
    },

    'startChild': {
        'should not require options': function(t) {
            var qm = qcluster.createCluster();
            var child = mockChild();
            var spy = t.spy(child, 'once');
            qm.startChild(child);
            t.equal(spy.callCount, 4);
            t.equal(spy.getAllArguments()[0][0], 'ready');
            t.equal(spy.getAllArguments()[1][0], 'started');
            t.equal(spy.getAllArguments()[2][0], 'listening');
            t.equal(spy.getAllArguments()[3][0], 'exit');
            t.done();
        },

        'should ignore redundant events': function(t) {
            var qm = qcluster.createCluster();
            var child = mockChild();
            var handlers = [];
            var spy = t.spy(child, 'once', function(name, handler) { handlers.push(handler) });
            var ncalls = 0;
            qm.startChild(child, function() {
                ncalls += 1;
            });
            handlers[0]();
            handlers[1]();
            handlers[2]();
            setTimeout(function() {
                t.equal(ncalls, 1);
                t.done();
            }, 10);
        },

        'should ignore listening if configured off': function(t) {
            var qm = qcluster.createCluster({ startedIfListening: false });
            var child = mockChild();
            var spy = t.spy(child, 'once');
            qm.startChild(child);
            t.equal(spy.callCount, 3);
            t.equal(spy.getAllArguments()[0][0], 'ready');
            t.equal(spy.getAllArguments()[1][0], 'started');
            t.equal(spy.getAllArguments()[2][0], 'exit');
            t.done();
        },
    },

    'killChild': {
        'should accept null child': function(t) {
            var qm = qcluster.createCluster();
            qm.killChild(null);
            t.done();
        },

        'should accept invalid child': function(t) {
            var qm = qcluster.createCluster();
            qm.killChild({});
            t.done();
        },
    },

    'replaceChild': {
        'should reject invalid child': function(t) {
            var qm = qcluster.createCluster();
            t.stub(qm, '_doReplaceChild');
            var tests = [
                // child, isInvalid?
                [ false, 1 ],
                [ null, 1 ],
                [ {}, 1 ],
                [ { _pid: undefined }, 1 ],
                [ { _pid: null }, 1 ],
                [ { _pid: 1 }, 0 ],
            ];
            var errCount = 0;
            var expectedErrCount = 0;
            for (var i=0; i<tests.length; i++) {
                expectedErrCount += tests[i][1];
                qm.replaceChild(tests[i][0], function(err) { if (err) errCount += 1; });
            }
            setTimeout(function() {
                t.equal(errCount, expectedErrCount);
                t.done();
            }, 10);
        },

        'should require callback': function(t) {
            var qm = qcluster.createCluster();
            t.throws(function() {
                qm.replaceChild({ _pid: 1 });
            });
            t.done();
        },

        'should queue child': function(t) {
            var qm = qcluster.createCluster();
            var child = mockChild();
            child._pid = 1;
            t.stub(qm, '_doReplaceChild');
            qm.replaceChild(child, function(){});
            t.equal(qm._replaceQueue.length, 1);
            t.equal(qm._replaceQueue[0].child, child);
            t.equal(typeof qm._replaceQueue[0].cb, 'function');
            t.done();
        },

        'should call _doReplaceChild, guarded by the _replacing flag': function(t) {
            var qm = qcluster.createCluster();
            t.strictEqual(qm._replacing, false);
            var child = mockChild();
            child._pid = 1;
            var stub = t.stub(qm, '_doReplaceChild', function(child, cb) { cb() });
            qm.replaceChild(child, function() {
                t.equal(stub.callCount, 1);
            })
            t.strictEqual(qm._replacing, true);
            setTimeout(function() {
                t.equal(qm._replacing, false);
                t.done();
            }, 10);
        },

        'should not call _doReplaceChild if already _replacing': function(t) {
            var qm = qcluster.createCluster();
            var child = mockChild();
            child._pid = 1;
            qm._replacing = true;
            var stub = t.stub(qm, '_doReplaceChild', function(child, cb) { cb() });
            qm.replaceChild(child, function(err) {});
            setTimeout(function(err) {
                t.equal(stub.callCount, 0);
                t.strictEqual(qm._replacing, true);
                t.done();
            }, 10);
        },

        'should dequeue child even if error': function(t) {
            var qm = qcluster.createCluster();
            var child = mockChild();
            child._pid = 1;
            t.stub(qm, '_doReplaceChild', function(child, cb) { cb(new Error("test error")) });
            qm.replaceChild(child, function(err, child) {
                t.ok(err);
                t.equal(err.message, 'test error');
                t.equal(qm._replaceQueue.length, 0);
                t.done();
            })
        },
    },

    'tests': {
        setUp: function(done) {
            /*
             * the tests *.js files check certain conditions and print results to stdout.
             * runTest() forks the named test and returns the printed output.
             */
            this.runTest = function runTest( which, callback ) {
                var cmdline = process.argv[0] + ' ' + __dirname + '/tests/' + which;
                child_process.exec(cmdline, function(err, stdout, stderr) {
                    callback(err, stdout + stderr);
                })
            }
            done();
        },

        'should quicktest': function(t) {
            this.runTest('quicktest', function(err, output) {
                t.contains(output, 'child started');
                t.contains(output, 'child running');
                t.contains(output, 'child killed');
                t.contains(output, 'child exited');
                t.contains(output, 'quicktest done, children.length: 0.');
                t.done();
            })
        },

        'should fork child': function(t) {
            this.runTest('fork-child', function(err, output) {
                t.contains(output, 'child process running.\n');
                t.done();
            })
        },

        'should kill child': function(t) {
            this.runTest('kill-child', function(err, output) {
                t.contains(output, 'child process SIGINT');
                t.contains(output, 'child process SIGTERM');
                t.done();
            })
        },

        'should stop child': function(t) {
            this.runTest('stop-child', function(err, output) {
                t.contains(output, 'child running');
                t.contains(output, 'child received stop');
                t.contains(output, 'child says stopped');
                t.contains(output, 'child stopped');
                t.done();
            })
        },

        'should stop child timeout': function(t) {
            this.runTest('stop-child-timeout', function(err, output) {
                t.contains(output, 'child running');
                t.contains(output, 'child received stop');
                t.contains(output, 'child err: stop timeout');
                t.done();
            })
        },

        'should exists child': function(t) {
            this.runTest('exists-child', function(err, output) {
                t.contains(output, 'child running');
                t.contains(output, 'child exists: true');
                t.contains(output, 'child gone: true');
                t.done();
            })
        },

        'should timeout start': function(t) {
            this.runTest('timeout-start', function(err, output) {
                // note: child is killed before it writes to stdout
                // t.contains(output, 'child running');
                t.contains(output, 'error: start timeout');
                t.contains(output, 'child exists? false');
                t.done();
            })
        },

        'should ignore multiple started': function(t) {
            this.runTest('ignore-multiple-started', function(err, output) {
                output = output.toString();
                var pos1 = output.indexOf('child started');
                t.ok(pos1 >= 0);
                var pos2 = output.indexOf('child started', pos1 + 13);
                t.ok(pos2 === -1);
                t.contains(output, 'startedCount = 3');
                t.done();
            })
        },

        'should relay fork signals': function(t) {
            this.runTest('relay-fork-signals', function(err, output) {
                t.contains(output, 'queued signal: SIGINT');
                t.contains(output, 'child running');
                t.contains(output, 'child SIGINT');
                t.contains(output, 'child exists? false');
                t.done();
            })
        },

        'should relay stop': function(t) {
            this.runTest('relay-stop', function(err, output) {
                t.contains(output, 'callCount = 2');
                t.contains(output, 'signal = SIGSTOP');
                t.done();
            })
        },

        'should replace child': function(t) {
            this.runTest('replace-child', function(err, output) {
                var ix1 = output.indexOf('children before replace pid');
                var ix2 = output.indexOf('children after replace pid');
                var pid1 = parseInt(output.slice(ix1).split(' ')[4]);
                var pid2 = parseInt(output.slice(ix2).split(' ')[4]);
                t.contains(output, 'child1 pid ' + pid1);
                t.contains(output, 'child2 pid ' + pid2);
                t.contains(output, 'pids differ true');
                t.contains(output, 'children before replace pid ' + pid1);
                t.contains(output, 'children before replace length = 1');
                t.contains(output, 'children after replace pid ' + pid2);
                t.contains(output, 'children after replace length = 1');
                t.ok(ix1 > 0 && ix2 > 0);
                t.done();
            })
        },

        'should replace child fork error': function(t) {
            this.runTest('replace-child-fork-error', function(err, output) {
                t.contains(output, 'child1 pid');
                t.contains(output, 'child2 replace error: true');
                t.contains(output, 'start timeout');
                t.contains(output, 'still have child1: true');
                t.contains(output, 'child2 exited');
                t.done();
            })
        },

        'should replace child stop timeout': function(t) {
            this.runTest('replace-child-stop-timeout', function(err, output) {
                t.contains(output, 'child1 pid');
                t.contains(output, 'child2 replace error: true');
                t.contains(output, 'stop timeout');
                t.contains(output, 'still have child1: true');
                t.contains(output, 'child2 exited');
                t.done();
            })
        },

        'should relay signals': function(t) {
            this.runTest('relay-signals', function(err, output) {
                t.contains(output, 'child running');
                t.contains(output, 'child SIGINT');
                t.contains(output, 'child exists? false');
                t.done();
            })
        },

        'should hoist events': function(t) {
            this.runTest('hoist-events', function(err, output) {
                t.contains(output, 'parent: got ready');
                t.contains(output, 'parent: got listening');
                t.contains(output, 'parent: got started');
                t.contains(output, 'parent: got stopped');
                t.contains(output, 'child: got start');
                t.contains(output, 'child: got stop');
                t.contains(output, 'child: got quit');
                t.contains(output, 'parent: child exited');
                t.ok(output.indexOf('other') < 0);
                t.done();
            })
        },
    },
}

function mockChild( pid ) {
    if (!pid) pid = 12345678;
    function noop(){};
    return {
        process: { pid: pid, on: noop, once: noop, kill: noop },
        on: noop,
        once: noop,
        send: noop,
        removeListener: noop,
    }
}
