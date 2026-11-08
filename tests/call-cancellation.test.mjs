import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { CALL_SIGNAL_ACK_TIMEOUT_MS } from '../src/callSignaling.js';
const source=fs.readFileSync('src/App.jsx','utf8');
const start=source.indexOf('  const startCall =');
const end=source.indexOf('  const answerCall =',start);
async function scenario(action){
 const generation={current:0},accepted={current:false};let ack,signals=0,timeout;
 const statuses=[];
 const socket={timeout(ms){timeout=ms;return this;},emit(_name,_data,cb){signals++;ack=cb;}};
 const noop=()=>{};
 const context={roomId:'test',myName:'Test',socketRef:{current:socket},inCall:false,callAttemptRef:generation,pcRef:{current:{connectionState:'new'}},
 cleanupCall(){generation.current++;},unlockRemoteAudio:async()=>{},setCallType:noop,activeCallTypeRef:{},setRemoteName:noop,setConnectionMessage:m=>statuses.push(m),setInCall:noop,isCallerRef:{},acceptedRef:accepted,pendingOfferRef:{},iceQueueRef:{},startLocalMedia:async()=>{},ensureCallRoomReady:async()=>true,startOfferFlow:async()=>true,offerPreparedRef:{},CALL_SIGNAL_ACK_TIMEOUT_MS,wait:async()=>{},console};
 const run=vm.runInNewContext(source.slice(start,end)+'\nstartCall',context);
 const pending=run('audio');await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(signals,1);assert.equal(timeout,4000);
 if(action==='hangup')generation.current++;
 if(action==='accept')accepted.current=true;
 const before=statuses.length;ack(null,{ok:true,recipients:0});await pending;
 assert.equal(signals,1);assert.equal(statuses.length,before);
}
await scenario('hangup');await scenario('accept');
// Simultaneous incoming accept and outgoing preparation share one SDP offer.
const begin=source.indexOf('  const startOfferFlow =');const finish=source.indexOf('\n  useEffect(',begin);
let release,offers=0;const gate=new Promise(resolve=>{release=resolve;});
const pc={createOffer:async()=>{offers++;return{type:'offer'};},setLocalDescription:async()=>{}};
const prepare=vm.runInNewContext(source.slice(begin,finish)+'\nstartOfferFlow',{
 callAttemptRef:{current:0},offerPreparationRef:{current:null},offerPreparedRef:{current:false},pcRef:{current:pc},activeCallTypeRef:{},ensureCallRoomReady:async()=>true,startLocalMedia:async()=>{},prepareCallRoutes:()=>gate,applyCallBandwidthLimits:async()=>{},socketRef:{current:{emit(){}}},roomId:'test',myName:'Test',
});
const a=prepare('audio'),b=prepare('audio');assert.equal(a,b);release();await Promise.all([a,b]);assert.equal(offers,1);
console.log('Call cancellation passed: no retries after hangup/accept, bounded ack and single SDP offer under concurrent setup.');
