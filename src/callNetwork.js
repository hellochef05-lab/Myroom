// Warm once when the room opens; calls share an in-flight lookup rather than
// racing negotiation against an unobserved background fetch.
export function createIceConfigLoader(url, {
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  timeoutMs = 4000,
} = {}) {
  let pending;
  let cached;
  let expiresAt = 0;
  return () => {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (pending) return pending;
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Call route lookup timed out'));
      }, timeoutMs);
    });
    const request = Promise.resolve().then(() => fetchImpl(url, {
      cache: 'no-store', signal: controller.signal,
    })).then(async response => {
      if (!response.ok) throw new Error('Call route lookup failed');
      const data = await response.json();
      if (!Array.isArray(data?.iceServers)) throw new Error('Invalid call routes');
      return data;
    });
    pending = Promise.race([request, timeout]).then(data => {
      cached = data;
      // Retry absent relay configuration soon after an administrator enables it.
      expiresAt = now() + (data.relayConfigured ? 60000 : 10000);
      return data;
    }).finally(() => {
      clearTimeout(timer);
      pending = undefined;
    });
    return pending;
  };
}

export const callVideoConstraints = (facingMode) => ({
  facingMode: { ideal: facingMode },
  width: { ideal: 640, max: 640 },
  height: { ideal: 360, max: 480 },
  frameRate: { ideal: 15, max: 15 },
});

// Browser congestion control can reduce further below these ceilings. Parameter
// support varies (notably Safari), so an unsupported limit must not end a call.
export async function applyCallBandwidthLimits(pc) {
  await Promise.all((pc?.getSenders?.() || []).map(async sender => {
    const kind = sender.track?.kind;
    if (!['audio', 'video'].includes(kind)) return;
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return;
      for (const encoding of parameters.encodings) {
        const ceiling = kind === 'audio' ? 32000 : 350000;
        encoding.maxBitrate = Math.min(encoding.maxBitrate ?? ceiling, ceiling);
        if (kind === 'video') {
          encoding.maxFramerate = Math.min(encoding.maxFramerate ?? 15, 15);
        }
      }
      await sender.setParameters(parameters);
    } catch {
      // Retain the negotiated browser defaults if RTP parameter changes fail.
    }
  }));
}
