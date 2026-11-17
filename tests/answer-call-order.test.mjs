import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('src/App.jsx', 'utf8');
const start = source.indexOf('  const answerCall = async');
const end = source.indexOf('  const declineCall =', start);
const offerStart = source.indexOf('  const handleOffer = async');
const offerEnd = source.indexOf('  const startOfferFlow =', offerStart);
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const events = [];
  const pc = {
    signalingState: 'stable',
    setRemoteDescription: async () => events.push('remote description'),
    createAnswer: async () => ({ type: 'answer' }),
    setLocalDescription: async () => events.push('local description'),
  };
  let finishMedia, finishRoutes, finishRoom;
  const savedOffer = { offer: { type: 'offer' }, callType: 'audio' };
  const warmed = Promise.resolve();
  const noop = () => {};
  const context = {
    callsEnabled: true, incoming: { callType: 'audio' }, roomId: 'room',
    callAttemptRef: { current: 0 }, answeringRef: { current: false }, acceptedRef: { current: false },
    incomingRoutesRef: { current: warmed }, answerPreparedPeerRef: { current: null },
    pcRef: { current: pc }, pendingOfferRef: { current: savedOffer }, iceQueueRef: { current: [] },
    socketRef: { current: { emit(_name, { data }) { events.push(data.type); } } },
    startLocalMedia() { events.push('media'); return new Promise(resolve => { finishMedia = resolve; }); },
    prepareCallRoutes(peer, lookup) {
      assert.equal(peer, pc); assert.equal(lookup, warmed);
      events.push('routes');
      return new Promise(resolve => { finishRoutes = resolve; });
    },
    ensureCallRoomReady: () => new Promise(resolve => { finishRoom = resolve; }),
    RTCSessionDescription: function Description(value) { return value; },
    applyCallBandwidthLimits() { events.push('bandwidth'); return new Promise(noop); },
    activeCallTypeRef: {}, callActiveRef: {}, unlockRemoteAudio: async () => {},
    setAnswering: noop, setCallType: noop, setRemoteName: noop, setConnectionMessage: noop,
    setInCall: noop, setIncoming: noop, cleanupCall: noop, console,
  };
  const answer = vm.runInNewContext(source.slice(offerStart, offerEnd) + source.slice(start, end) + '\nanswerCall', context);
  return { answer, events, context, releaseRoom: () => finishRoom(true), releaseMedia: () => finishMedia(), releaseRoutes: () => finishRoutes() };
}

const live = setup();
const answer = live.answer();
await live.answer();
assert.deepEqual(live.events, ['media', 'routes'], 'prepare in parallel and ignore repeated taps');
live.releaseRoom();
await tick();
assert.deepEqual(live.events, ['media', 'routes', 'accept'], 'the caller can prepare before the callee microphone and routes are ready');
live.releaseMedia();
await tick();
assert.equal(live.context.acceptedRef.current, false, 'incoming offers must remain queued while route setup finishes');
live.releaseRoutes();
await answer;
assert.deepEqual(live.events, ['media', 'routes', 'accept', 'remote description', 'local description', 'answer', 'bandwidth']);

const cancelled = setup();
const pending = cancelled.answer();
cancelled.context.callAttemptRef.current++;
cancelled.releaseRoom();
cancelled.releaseMedia();
cancelled.releaseRoutes();
await pending;
assert.deepEqual(cancelled.events, ['media', 'routes'], 'cancelled answers must not signal or negotiate');
console.log('Answer timing passed: parallel preparation and acceptance, no duplicate taps, cancellation and no wait for bitrate limits.');
