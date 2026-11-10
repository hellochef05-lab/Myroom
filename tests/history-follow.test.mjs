import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/App.jsx','utf8');
const begin=source.indexOf('  const beginUserScroll =');
const end=source.indexOf('\n  return (',begin);
const pinned={current:true}, scrolling={current:false};
const timers=[];
const context={
 pinnedToLatestRef:pinned,userIsScrollingRef:scrolling,
 interactionResetTimerRef:{current:0},followFrameRef:{current:0},keyboardSettleTimerRef:{current:0},
 initialPositionReady:true,historyPaginationEnabled:true,
 cancelAnimationFrame(){},
 window:{clearTimeout(){},setTimeout(cb){timers.push(cb);return timers.length;}},
};
const {beginUserScroll,finishUserScroll,recordUserScrollPosition}=vm.runInNewContext(source.slice(begin,end)+'\n({beginUserScroll,finishUserScroll,recordUserScrollPosition})',context);
// iOS may defer scroll events until after touchend/keyboard animation. Detach
// on touch itself, and remain detached after the old 220ms gesture timeout.
beginUserScroll();assert.equal(pinned.current,false);
finishUserScroll();timers.splice(0).forEach(cb=>cb());assert.equal(scrolling.current,false);
assert.equal(pinned.current,false);
const list={scrollHeight:1000,clientHeight:500,scrollTop:500};
scrolling.current=true;
recordUserScrollPosition({target:{closest(){return list;}}});
assert.equal(pinned.current,false); // resize/scroll reaching bottom cannot opt in
let moves=0;
const sendStart=source.indexOf('    const scrollAfterOwnSend =');
const sendEnd=source.indexOf('    window.addEventListener',sendStart);
vm.runInNewContext(source.slice(sendStart,sendEnd)+'\nscrollAfterOwnSend()',{...context,moveToLatest(){moves++;}});
assert.equal(pinned.current,true);assert.equal(scrolling.current,false);assert.equal(moves,1);
console.log('History follow passed: delayed iOS events, expired gesture timer, resize-to-bottom and explicit resume.');
