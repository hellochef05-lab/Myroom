import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/App.jsx','utf8');
function handler(name,next,context){
 const start=source.indexOf(`    const ${name} = `);
 const end=source.indexOf(`\n    const ${next} = `,start);
 return vm.runInNewContext(source.slice(start,end)+`\n${name}`,context);
}
const pinned={current:false}, scrolling={current:false};
let scheduled=0;
const context={pinnedToLatestRef:pinned,userIsScrollingRef:scrolling,keyboardSettleTimerRef:{current:0},moveToLatest(){},window:{clearTimeout(){},setTimeout(){scheduled++;}}};
const focus=handler('keepLatestAboveKeyboard','settleKeyboardResize',context);
const event={target:{closest:()=>true}};
focus(event); assert.equal(pinned.current,false); assert.equal(scheduled,0);
pinned.current=true; focus(event); assert.equal(scheduled,1);
scrolling.current=true; focus(event); assert.equal(scheduled,1);
const frames=[];const list={scrollHeight:1000,clientHeight:200,scrollTop:100};
const follow=handler('moveToLatest','scrollAfterOwnSend',{pinnedToLatestRef:pinned,userIsScrollingRef:scrolling,followFrameRef:{current:0},list,cancelAnimationFrame(){},requestAnimationFrame(cb){frames.push(cb);return frames.length;}});
follow();while(frames.length)frames.shift()();assert.equal(list.scrollTop,100);
scrolling.current=false;follow();while(frames.length)frames.shift()();assert.equal(list.scrollTop,800);
// Execute the production accept branch with a cached offer for a late joiner.
const start=source.indexOf('        if (data.type === "accept") {');
const end=source.indexOf('        if (data.type === "ice-restart-request")',start);
const signals=[];
const accept=vm.runInNewContext('(async (data)=>{'+source.slice(start,end)+'})',{
 isCallerRef:{current:true},offerPreparedRef:{current:true},pcRef:{current:{localDescription:{type:'offer',sdp:'prepared'}}},socketRef:{current:{emit(type,payload){signals.push(payload.data);}}},roomId:'room',myName:'caller',localIceCandidatesRef:{current:[{candidate:'relay-route'}]},setConnectionMessage(){},armConnectionRecovery(){},
});
await accept({type:'accept',offerReady:false,callType:'audio'});
assert.deepEqual(signals.map(s=>s.type),['offer','ice']);
assert.equal(signals[1].candidate.candidate,'relay-route');
console.log('Passed: preserve history on focus; follow latest on focus; respect active gesture; prevent delayed scroll; follow latest when idle; replay late-join ICE.');
