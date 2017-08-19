qcluster
========

[![Build Status](https://api.travis-ci.org/andrasq/node-qcluster.svg?branch=master)](https://travis-ci.org/andrasq/node-qcluster?branch=master)
[![Coverage Status](https://codecov.io/github/andrasq/node-qcluster/coverage.svg?branch=master)](https://codecov.io/github/andrasq/node-qcluster?branch=master)

Robust worker cluster management.

(work in progress)


## API

### qm = qcluster.createCluster( [options,] [callback] )

### qm.forkChild( [callback] )

### qm.startChild( child, callback )

### qm.stopChild( child, callback )

### qm.killChild( child, [signal] )

### qm.replaceChild( child, callback )

Fork new child, wait for it to be ready, tell old child to stop, then when stopped
start new child.


## Summary

    const qcluster = require('qcluster');
    const master = qcluster.createCluster();

    var child = master.forkChild();


## Todo

- 
