import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/PublicEngineGate.jsx", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "jsx", jsx: "automatic", format: "cjs" });
const module = { exports: {} };
const app = Symbol("chat");
const window = Object.assign(new EventTarget(), { performance: {} });
const document = Object.assign(new EventTarget(), { hidden: false });
const element = (type, props) => ({ type, props });
const state = [];
let useStateIndex = 0;
let effect;
let pendingRead;
let timer;
let delay;
const imports = {
  "react/jsx-runtime": { jsx: element, jsxs: element },
  "./engineStatus.js": {
    ENGINE_UNAVAILABLE: "Sayup is unavailable right now.",
    wasEngineVerifiedForNavigation: () => false,
    readEngineStatus: (_apiBase, timeoutMs) => {
      if (state[1] === "checking") assert.ok(timeoutMs >= 60_000);
      return new Promise((resolve) => { pendingRead = resolve; });
    },
  },
  react: {
    useEffect: (callback) => { effect = callback; },
    useState: (initial) => {
      const index = useStateIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = value; }];
    },
  },
};
runInNewContext(code, {
  module,
  require: (name) => imports[name],
  window,
  document,
  setTimeout: (callback, ms) => { timer = callback; delay = ms; },
  clearTimeout: () => { timer = undefined; },
});
const render = () => {
  useStateIndex = 0;
  return module.exports.default({ apiBase: "https://example.com", children: app });
};
const statusHeading = () => render().props.children[0].props.children;
const resolveCheck = async (enabled) => {
  pendingRead(enabled);
  await new Promise((resolve) => setImmediate(resolve));
};
assert.equal(statusHeading(), "Connecting to Sayup…");
const close = effect();
await resolveCheck(null);
assert.equal(statusHeading(), "Connecting to Sayup…", "an unknown status keeps the chat closed and retries");
assert.equal(delay, 5_000);
timer();
await resolveCheck(true);
assert.equal(render(), app, "the chat opens once the Engine is confirmed on");
assert.equal(delay, 15_000);
timer();
await resolveCheck(null);
assert.equal(render(), app, "an intermittent status failure leaves the mounted chat alone");
timer();
window.dispatchEvent(new Event("sayup:engine-off"));
await resolveCheck(true);
assert.equal(statusHeading(), "Sayup is unavailable right now.", "an older result cannot override live shutdown");
timer();
await resolveCheck(false);
assert.equal(statusHeading(), "Sayup is unavailable right now.");
close();
assert.equal(timer, undefined);
