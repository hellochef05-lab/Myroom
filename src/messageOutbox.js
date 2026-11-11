export function createOutboxFlusher({ readQueue, writeQueue, sendMessage, updateMessage,
  canSend = () => true, schedule = setTimeout, cancel = clearTimeout,
}) {
  let pending;
  let retryTimer;
  let failures = 0;
  let active = true;
  const rejected = new Set();
  const acknowledgments = new Map();
  const hasPending = () => readQueue().some(item => !rejected.has(item.id));
  const clearRetry = () => { cancel(retryTimer); retryTimer = undefined; };
  const flush = () => {
    clearRetry();
    if (pending) return pending;
    if (!active || !canSend()) return Promise.resolve();
    const attempted = new Set();
    const run = async () => {
      for (;;) {
        if (!active || !canSend()) return;
        // Reread after each acknowledgment; never overwrite a newer queued send.
        const item = readQueue().find(entry => !attempted.has(entry.id) && !rejected.has(entry.id));
        if (!item) return;
        attempted.add(item.id);
        const localMessage = {
          ...item.localMessage,
          created_at: item.localMessage?.created_at ? new Date(item.localMessage.created_at) : new Date(),
          status: 'sending', sayup_queued: true,
        };
        updateMessage?.(localMessage);
        let response;
        try {
          // Reuse the original message ID on every attempt. A lost response
          // must not create a second copy when the server accepted the first.
          const acknowledged = new Promise(resolve => acknowledgments.set(item.id, resolve));
          response = await Promise.race([
            sendMessage({ ...item.message, id: item.message.id || item.id }, item.sendOptions),
            acknowledged,
          ]);
          failures = 0;
        } catch (error) {
          // Match the installed SDK's duplicate-message acknowledgment rule.
          if (Number(error?.code) === 4 && String(error?.message).includes('already exists')) {
            writeQueue(readQueue().filter(entry => entry.id !== item.id));
            updateMessage?.({ ...localMessage, status: 'received', sayup_queued: false });
            failures = 0;
            continue;
          }
          const status = Number(error?.status || error?.response?.status);
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            rejected.add(item.id);
            updateMessage?.({ ...localMessage, status: 'failed', sayup_queued: false });
          }
          continue;
        } finally {
          acknowledgments.delete(item.id);
        }
        writeQueue(readQueue().filter(entry => entry.id !== item.id));
        if (response?.message) {
          updateMessage?.({ ...response.message, status: 'received', sayup_queued: false });
        }
      }
    };
    pending = Promise.resolve().then(run);
    const current = pending;
    const release = () => {
      if (pending !== current) return;
      pending = undefined;
      if (!active || !canSend() || !hasPending()) return;
      const delay = Math.min(1000 * 2 ** Math.min(failures++, 4), 10000);
      retryTimer = schedule(() => { retryTimer = undefined; return flush(); }, delay);
      retryTimer?.unref?.();
    };
    current.then(release, release);
    return current;
  };
  flush.acknowledge = message => {
    if (!message?.id || !readQueue().some(item => item.id === message.id)) return;
    writeQueue(readQueue().filter(item => item.id !== message.id));
    updateMessage?.({ ...message, status: 'received', sayup_queued: false });
    acknowledgments.get(message.id)?.({ message });
  };
  flush.pause = () => { active = false; clearRetry(); };
  flush.dispose = flush.pause;
  flush.start = () => { active = true; failures = 0; return flush(); };
  return flush;
}

export function createDraftSafeSubmit({ composer, enqueue, flush, onQueued, onError = () => {},
  schedule = setTimeout, cancel = clearTimeout,
}) {
  let restoreState;
  let timer;
  const restoreTyping = () => {
    if (!restoreState) return;
    const { publishTypingEvents } = restoreState;
    restoreState = undefined;
    composer.updateConfig({ text: { publishTypingEvents } });
  };
  return {
    submit(params) {
      // The SDK has already cleared the SENT composition before this handler.
      // Finish its submission immediately once durable enqueue succeeds. No
      // request completion, failure, or timer may clear/restore a later draft.
      enqueue(params);
      if (!restoreState) {
        restoreState = { publishTypingEvents: composer.config.text.publishTypingEvents };
      }
      composer.updateConfig({ text: { publishTypingEvents: false } });
      cancel(timer);
      timer = schedule(restoreTyping, 0);
      try { onQueued?.(params); } catch (error) { onError(error); }
      void Promise.resolve().then(flush).catch(onError);
    },
    dispose() {
      cancel(timer);
      restoreTyping();
    },
  };
}
