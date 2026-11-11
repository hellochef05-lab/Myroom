import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('src/App.jsx', 'utf8');
const start = source.indexOf('function getStreamClient()');
const end = source.indexOf('\nasync function connectStreamUserWithRetry', start);
const handlers = [];
const client = { axiosInstance: { interceptors: { request: { use(fn) { handlers.push(fn); } } } } };
let defaults;
const configure = fs.existsSync('src/fastMessageRequests.js')
  ? (await import('../src/fastMessageRequests.js')).configureFastMessageRequests
  : value => value;
const factory = vm.runInNewContext(source.slice(start, end) + '\ngetStreamClient', {
  StreamChat: { getInstance(key, options) { defaults = options; return client; } },
  apiKey: 'test-key', STREAM_REQUEST_TIMEOUT_MS: 20000, configureFastMessageRequests: configure,
});
factory(); factory();
const configFor = (url, method = 'post', timeout = defaults.timeout) => handlers.reduce((config, fn) => fn(config), { url, method, timeout });
assert.equal(configFor('https://chat.stream-io-api.com/channels/messaging/room/message').timeout, 6000,
  'a stalled message request must not hold subsequent messages for the global 20-second request timeout');
assert.equal(handlers.length, 1, 'singleton client must not accumulate interceptors');
assert.equal(configFor('/channels/messaging/room/message', 'POST', 2000).timeout, 2000, 'retain stricter explicit deadlines');
assert.equal(configFor('/channels/messaging/room/image', 'post', 0).timeout, 0, 'file uploads retain their existing timeout');
assert.equal(configFor('/channels/messaging/room/query').timeout, 20000, 'room history is unaffected');
assert.equal(configFor('/channels/messaging/room/message', 'get').timeout, 20000);
console.log('Message-only deadline: 6 seconds instead of 20; uploads, room queries and existing stricter deadlines unaffected.');
// Verify the hook on the installed SDK's real channel.sendMessage HTTP path.
// All transport requests use an in-memory adapter; no external requests occur.
const { StreamChat } = await import('stream-chat');
const { configureFastMessageRequests } = await import('../src/fastMessageRequests.js');
const sdkClient = new StreamChat('test-api-key', 'test-only-secret', {
  browser: false, timeout: 20000, enableInsights: false,
});
configureFastMessageRequests(sdkClient);
const requests = [];
sdkClient.axiosInstance.defaults.adapter = async config => {
  requests.push(config);
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  return { data: { message: body?.message }, status: 200, statusText: 'OK', headers: {}, config };
};
const room = sdkClient.channel('messaging', 'test-room');
await room.sendMessage({ id: 'stable-test-id', text: 'test' });
assert.equal(requests[0].timeout, 6000);
assert.equal(JSON.parse(requests[0].data).message.id, 'stable-test-id');
await sdkClient.post(sdkClient.baseURL + '/channels/messaging/test-room/query', {});
assert.equal(requests[1].timeout, 20000);
console.log('Installed SDK send path uses the fast deadline, preserves message IDs and retains history timeout.');
