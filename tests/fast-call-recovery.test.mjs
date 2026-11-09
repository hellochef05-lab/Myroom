import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/App.jsx','utf8');
const start=source.indexOf('  const armConnectionRecovery =');
const end=source.indexOf('  const restartIceAndRenegotiate =',start);
const callbacks=[],delays=[];let restarts=0;
const peer={connectionState:'connecting',iceConnectionState:'checking',signalingState:'stable'};
const pcRef={current:peer},generation={current:0},used={current:false};
const arm=vm.runInNewContext(source.slice(start,end)+'\narmConnectionRecovery',{
 connectionAttemptTimeoutRef:{current:null},callAttemptRef:generation,pcRef,fastRecoveryUsedRef:used,
 setTimeout(cb,delay){callbacks.push(cb);delays.push(delay);return callbacks.length;},clearTimeout(){},restartIceAndRenegotiate(){restarts++;},
});
arm('first');assert.equal(delays.at(-1),3000);callbacks.at(-1)();assert.equal(restarts,1);
arm('retry');assert.equal(delays.at(-1),12000);callbacks.at(-1)();assert.equal(restarts,2);
used.current=false;peer.connectionState='connected';arm('connected');callbacks.at(-1)();assert.equal(restarts,2);
peer.connectionState='connecting';arm('cancelled');generation.current++;callbacks.at(-1)();assert.equal(restarts,2);
arm('replaced-peer');pcRef.current={...peer};callbacks.at(-1)();assert.equal(restarts,2);
pcRef.current=peer;peer.signalingState='closed';arm('closed');callbacks.at(-1)();assert.equal(restarts,2);
console.log('Recovery tests passed: first retry at 3s, later backoff, no retries after connection, hang-up, peer replacement or closure.');
