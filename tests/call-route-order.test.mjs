import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/App.jsx','utf8');
const begin=source.indexOf('  const startOfferFlow =');
const end=source.indexOf('\n  useEffect(',begin);
const steps=[];let release;
const routeReady=new Promise(resolve=>{release=resolve;});
const pc={createOffer:async()=>{steps.push('offer');return{type:'offer'};},setLocalDescription:async()=>steps.push('description')};
const run=vm.runInNewContext(source.slice(begin,end)+'\nstartOfferFlow',{
 callAttemptRef:{current:0},offerPreparationRef:{current:null},offerPreparedRef:{current:false},pcRef:{current:pc},activeCallTypeRef:{current:null},
 ensureCallRoomReady:async()=>true,startLocalMedia:async()=>steps.push('media'),
 prepareCallRoutes:async()=>{await routeReady;steps.push('routes');},applyCallBandwidthLimits:async()=>steps.push('limits'),
 socketRef:{current:{emit(){steps.push('signal');}}},roomId:'test',myName:'Test',
});
const pending=run('audio');await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(steps,['media']);release();await pending;
assert.deepEqual(steps,['media','routes','offer','description','limits','signal']);
console.log('Call route ordering passed: no offer/signaling before routes, media starts concurrently.');
