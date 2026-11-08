import assert from 'node:assert/strict';
import { createRoomJoiner } from '../src/callSignaling.js';
class Socket {
  connected=true;id='first';listeners=new Map();emits=[];
  on(name,fn){const set=this.listeners.get(name)||new Set();set.add(fn);this.listeners.set(name,set);}
  once(name,fn){const once=(...a)=>{this.off(name,once);fn(...a);};this.on(name,once);}
  off(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name){for(const fn of [...(this.listeners.get(name)||[])])fn();}
  timeout(){return this;}
  emit(name,payload,ack){this.emits.push({name,payload,ack});}
  connect(){this.connects=(this.connects||0)+1;}
}
const s=new Socket();const j=createRoomJoiner(s,'room');
const first=j.ensure();assert.equal(j.ensure(),first);assert.equal(s.emits.length,1);
s.emits[0].ack(null,{ok:true});assert.equal(await first,true);
assert.equal(await j.ensure(),true);assert.equal(s.emits.length,1); // no extra join RTT on calls
s.connected=false;s.fire('disconnect');s.id='second';s.connected=true;
const second=j.ensure();assert.equal(s.emits.length,2);s.emits[1].ack(null,{ok:true});assert.equal(await second,true);
s.connected=false;s.fire('disconnect');const reconnect=j.ensure();assert.equal(s.connects,1);
s.id='third';s.connected=true;s.fire('connect');assert.equal(s.emits.length,3);
s.emits[2].ack(null,{ok:true});assert.equal(await reconnect,true);
s.connected=false;s.fire('disconnect');s.connected=true;const disposed=j.ensure();j.dispose();assert.equal(await disposed,false);
s.emits.at(-1).ack(null,{ok:true});assert.equal(await j.ensure(),false); // late ack cannot resurrect disposed session
const slow=new Socket();const bounded=createRoomJoiner(slow,'room',{timeoutMs:5});
assert.equal(await bounded.ensure(),false);bounded.dispose();
console.log('Signaling tests passed: shared joins, cached membership, reconnect, timeout, disposal and stale acknowledgements.');
