import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { chatReactions } from "../src/chatReactions.js";

const sourceUrl = new URL("../src/FloatingReactions.jsx", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
const { code } = transformSync(source, { loader: "jsx", jsx: "automatic", format: "cjs" });
const effects = [];
const motion = { matches: false };
const document = { hidden: false };
const sequence = { current: 0 };
let items = [];
const listeners = new Map();
const channel = {
  on(type, handler) {
    listeners.set(type, handler);
    return { unsubscribe: () => listeners.delete(type) };
  },
};
const element = (type, props, key) => ({ type, props, key });
const imports = {
  "react/jsx-runtime": { jsx: element },
  "./chatReactions.js": { chatReactions },
  react: {
    useEffect: (effect) => effects.push(effect),
    useRef: () => sequence,
    useState: () => [items, (update) => { items = update(items); }],
  },
};
const module = { exports: {} };
runInNewContext(code, {
  module,
  require: (name) => imports[name],
  window: { matchMedia: () => motion },
  document,
});
const FloatingReactions = module.exports.default;
const render = () => FloatingReactions({ channel });
const emit = (type, reaction) => listeners.get(type)?.({ reaction });

render();
const dispose = effects[0]();
emit("reaction.new", { type: "angry", user_id: "me" });
emit("reaction.new", { type: "love", user_id: "peer" });
emit("reaction.deleted", { type: "angry", user_id: "me" });
emit("reaction.new", { type: "unrecognized" });
const firstTray = render();
assert.equal(firstTray.props["aria-hidden"], "true");
const children = firstTray.props.children;
assert.equal(children.length, 2, "new reactions from either user float once");
assert.equal(children[0].props.children.props.children, "😠");
assert.equal(children[1].props.children.props.children, "❤️");
children[0].props.onAnimationEnd();
assert.equal(render().props.children.length, 1, "a finished animation is removed");

motion.matches = true;
emit("reaction.new", { type: "wow" });
motion.matches = false;
document.hidden = true;
emit("reaction.new", { type: "wow" });
document.hidden = false;
assert.equal(render().props.children.length, 1, "skip animations in reduced motion and hidden tabs");

for (let i = 0; i < 6; i++) emit("reaction.new", { type: "haha" });
assert.equal(render().props.children.length, 4, "reaction bursts have a bounded number of animations");
dispose();
assert.equal(listeners.size, 0, "leaving the room removes the subscription");
