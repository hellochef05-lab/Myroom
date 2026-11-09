export function createOutboxFlusher({ readQueue, writeQueue, sendMessage, updateMessage }) {
  let pending;
  return () => {
    if (pending) return pending;
    const attempted = new Set();
    const run = async () => {
      // Read the current queue after each request: a second send may have
      // arrived while the first request was pending. Never replace it with an
      // older snapshot of the queue.
      for (;;) {
        const item = readQueue().find(entry => !attempted.has(entry.id));
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
          response = await sendMessage(item.message, item.sendOptions);
        } catch {
          // Leave this item in storage for reconnection, without a tight retry.
          continue;
        }
        writeQueue(readQueue().filter(entry => entry.id !== item.id));
        if (response?.message) {
          updateMessage?.({ ...response.message, status: 'received', sayup_queued: false });
        }
      }
    };
    pending = Promise.resolve().then(run);
    const current = pending;
    const release = () => { if (pending === current) pending = undefined; };
    current.then(release, release);
    return current;
  };
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
