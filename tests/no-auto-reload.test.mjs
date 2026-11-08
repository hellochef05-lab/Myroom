import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const main=fs.readFileSync('src/main.jsx','utf8');
const start=main.indexOf('if ("serviceWorker" in navigator)');
const end=main.indexOf('\ncreateRoot',start);
const handlers={};let reloads=0,checks=0;
const events={addEventListener(name,fn){(handlers[name]||=[]).push(fn);}};
const sw={...events,controller:{},getRegistration:async()=>({update(){checks++;}})};
vm.runInNewContext(main.slice(start,end),{navigator:{serviceWorker:sw},window:{...events,location:{reload(){reloads++;}}},document:{...events,visibilityState:'visible'}});
for(const event of ['pageshow','visibilitychange','controllerchange','controllerchange']) {
 for(const fn of handlers[event]||[])await fn();
}
await Promise.resolve();assert.equal(checks,2);assert.equal(reloads,0);
console.log('Update test passed: foreground/update events check for new versions without reloading chats or drafts.');
