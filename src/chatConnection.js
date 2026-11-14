// Join and recovery share one watch request. Failed initial watches must be
// retried; an already watched room must never be repeatedly fetched/reset.
const watches = new WeakMap();
export function ensureChannelWatched(channel) {
  if (channel.initialized) return Promise.resolve();
  if (watches.has(channel)) return watches.get(channel);
  const pending = Promise.resolve().then(() => channel.watch({ presence: true }));
  watches.set(channel, pending);
  const release = () => { if (watches.get(channel) === pending) watches.delete(channel); };
  pending.then(release, release);
  return pending;
}

export function createChatConnectionRecovery({ client, channel, canRecover,
  schedule = setTimeout, cancel = clearTimeout,
}) {
  let pending, timer;
  let disposed = false;
  let failures = 0;
  const resume = () => {
    cancel(timer); timer = undefined;
    if (disposed || !canRecover()) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      try {
        // Public SDK method is a no-op for a healthy live connection and
        // shares its existing connection promise during reconnection.
        await client.openConnection();
        if (disposed || !canRecover()) return;
        await ensureChannelWatched(channel);
        failures = 0;
      } catch {
        if (!disposed && canRecover()) {
          timer = schedule(resume, Math.min(1000 * 2 ** Math.min(failures++, 4), 10000));
          timer?.unref?.();
        }
      }
    })();
    const current = pending;
    current.then(() => { if (pending === current) pending = undefined; });
    return current;
  };
  return { resume, pause() { cancel(timer); timer = undefined; },
    dispose() { disposed = true; cancel(timer); } };
}
