import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createOutboxFlusher, createDraftSafeSubmit } from '../src/messageOutbox.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
// Run the installed SDK's real submit handler, not a reimplementation, to
// verify that network failures cannot trigger its draft snapshot restoration.
const sdk=fs.readFileSync('node_modules/stream-chat-react/dist/components/MessageInput/hooks/useSubmitHandler.js','utf8')
 .replace(/^import .*;\n/gm,'').replace('export const useSubmitHandler','const useSubmitHandler');
let text='first message',sequence=0,clears=0,typingRequests=0;
const composer={
 config:{text:{publishTypingEvents:true}},
 updateConfig({text:config}){Object.assign(this.config.text,config);},
 compose:async()=>({localMessage:{id:String(++sequence),text},message:{text}}),
 clear(){clears++;text='';},
 channel:{cid:'test',stopTyping:async()=>{typingRequests++;throw new Error('offline');}},
 textComposer:{state:{getLatestValue:()=>text,next:v=>{text=v;}}},
};
for(const key of ['attachmentManager','linkPreviewsManager','pollComposer','customDataManager'])composer[key]={state:{getLatestValue:()=>({}),next(){}}};
composer.state={getLatestValue:()=>({}),next(){}};
let queue=[],resolveFirst,rejectSecond;const sent=[];
const flush=createOutboxFlusher({readQueue:()=>queue.slice(),writeQueue:q=>{queue=q;},sendMessage:async message=>{
 sent.push(message.text);
 if(sent.length===1)await new Promise(resolve=>{resolveFirst=resolve;});
 else await new Promise((_,reject)=>{rejectSecond=reject;});
 return{message};
}});
let savedConfig;const timers=[];
const submitter=createDraftSafeSubmit({composer,enqueue:p=>queue.push({id:p.localMessage.id,localMessage:p.localMessage,message:p.message}),flush,
 schedule:fn=>{timers.push(fn);return fn;},cancel:fn=>{const i=timers.indexOf(fn);if(i!==-1)timers.splice(i,1);}});
const hook=vm.runInNewContext(sdk+'\nuseSubmitHandler',{
 useCallback:fn=>fn,useMessageComposer:()=>composer,useChannelActionContext:()=>({addNotification(){throw new Error('Unexpected failed send notification');}}),useTranslationContext:()=>({t:x=>x}),
});
const {handleSubmit}=hook({overrideSubmitHandler:submitter.submit});
await handleSubmit();assert.equal(clears,1);assert.equal(queue.length,1);
text='second message';await handleSubmit();assert.equal(clears,2);assert.equal(queue.length,2);
text='new words I am still typing';
savedConfig=composer.config.text.publishTypingEvents;assert.equal(savedConfig,false);assert.equal(timers.length,1);
timers.splice(0).forEach(fn=>fn());assert.equal(composer.config.text.publishTypingEvents,true);assert.equal(text,'new words I am still typing');
resolveFirst();await tick();assert.deepEqual(sent,['first message','second message']);assert.equal(queue.length,1);assert.equal(queue[0].message.text,'second message');
rejectSecond(new Error('offline'));await tick();assert.equal(queue.length,1);assert.equal(text,'new words I am still typing');assert.equal(clears,2);assert.equal(typingRequests,0);
submitter.dispose();assert.equal(text,'new words I am still typing');
// Reconnect retries the failed item once, removes only that item and does not
// involve any composer state. Separate channels have independent queues.
const retry=createOutboxFlusher({readQueue:()=>queue,writeQueue:q=>{queue=q;},sendMessage:async m=>({message:m})});await retry();assert.equal(queue.length,0);assert.equal(text,'new words I am still typing');
const originalFalse={config:{text:{publishTypingEvents:false}},updateConfig({text:t}){Object.assign(this.config.text,t);}};
const disabled=createDraftSafeSubmit({composer:originalFalse,enqueue(){},flush:async()=>{throw new Error('delivery failed');},schedule:()=>0,cancel(){}});
disabled.submit({});disabled.dispose();await tick();assert.equal(originalFalse.config.text.publishTypingEvents,false);
assert.throws(()=>createDraftSafeSubmit({composer,enqueue(){throw new Error('storage full');},flush(){}}).submit({}),/storage full/);
console.log('Draft/outbox regression passed with actual SDK submit flow: slow first send, rapid second send, new draft, offline failure, reconnect and typing config restoration.');
