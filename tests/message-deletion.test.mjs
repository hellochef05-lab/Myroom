import assert from 'node:assert/strict';
import { deleteMessageImmediately, isMessageHidden } from '../src/messageDeletion.js';

const original = { id: 'photo', type: 'regular', attachments: [{ type: 'image' }] };
const pending = new Set();
let visibleMessage = original;
let confirmDelete;
const handlers = {
  setPending(id, hiding) { if (hiding) pending.add(id); else pending.delete(id); },
  deleteMessage: () => new Promise(resolve => { confirmDelete = resolve; }),
  updateMessage(message) { visibleMessage = message; },
};

const removal = deleteMessageImmediately(original, handlers);
assert.equal(isMessageHidden(visibleMessage, pending), true, 'sender hides media before the server replies');
assert.equal(isMessageHidden({ id: 'other' }, pending), false, 'other messages remain in view');
confirmDelete({ ...original, type: 'deleted' });
await removal;
assert.equal(pending.size, 0);
assert.equal(isMessageHidden(visibleMessage, pending), true, 'confirmed deletion stays hidden');
assert.equal(isMessageHidden({ ...original, deleted_at: new Date() }), true, 'deleted payloads are hidden on peer and gallery');

visibleMessage = original;
await assert.rejects(deleteMessageImmediately(original, {
  ...handlers, deleteMessage: async () => { throw new Error('offline'); },
}), /offline/);
assert.equal(pending.size, 0);
assert.equal(isMessageHidden(visibleMessage, pending), false, 'a failed deletion restores original media');
console.log('Message deletion passed: immediate hide, server confirmation, peer payload and rollback on failure.');
