import assert from 'node:assert/strict';
import { getChatViewportGeometry as geometry } from '../src/chatViewport.js';
// Keyboard closed -> open and panned -> closed again. A stale layout height
// must not cap the restored visual viewport, and panning must retain height.
assert.deepEqual(geometry({height:844,offsetTop:0},844),{height:844,top:0});
assert.deepEqual(geometry({height:480,offsetTop:220},844),{height:480,top:220});
assert.deepEqual(geometry({height:480,offsetTop:100},480),{height:480,top:100});
assert.deepEqual(geometry({height:844,offsetTop:0},480),{height:844,top:0});
assert.deepEqual(geometry({height:390,offsetTop:0},844),{height:390,top:0});
assert.deepEqual(geometry(null,720),{height:720,top:0});
assert.deepEqual(geometry({height:0,offsetTop:-5},720),{height:720,top:0});
assert.deepEqual(geometry(null,0),{height:null,top:0});
console.log('Viewport checks passed: keyboard open/close, panning, stale layout height, rotation and fallback.');
