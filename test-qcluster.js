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

    'should implement _callOnce': function(t) {
        var callOnce = qcluster.QCluster._callOnce;
        t.equal(typeof callOnce, 'function');
        var called = false;
        function func(a) { called = a; }
        var once = callOnce(func);
        once(123);
        once(234);
        once(345);
        t.equal(called, 123);
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

    'tests': {
        setUp: function(done) {
            /*
             * the tests *.js files check certain conditions and print results to stdout.
             * runTest() forks the named test and returns the printed output.
             */
            this.runTest = function runTest( which, callback ) {
                var cmdline = process.argv[0] + ' ' + __dirname + '/tests/' + which;
                child_process.exec(cmdline, function(err, stdout, stderr) {
                    callback(err, stdout, stderr);
                })
            }
            done();
        },

        'should quicktest': function(t) {
            this.runTest('quicktest', function(err, output) {
                t.contains(output, 'child started');
                t.contains(output, 'child running');
                t.contains(output, 'child killed');
                t.contains(output, 'child quit');
                t.contains(output, 'quicktest done.');
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

        'should exists child': function(t) {
            this.runTest('exists-child', function(err, output) {
                t.contains(output, 'child running');
                t.contains(output, 'child exists');
                t.contains(output, 'child gone');
                t.done();
            })
        },

        'should timeout start': function(t) {
            this.runTest('timeout-start', function(err, output) {
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
    }
}
