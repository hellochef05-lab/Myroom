import { useEffect, useState } from 'react';

export function presenceTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export function presenceSummary(member) {
  if (!member) return 'Presence unavailable';
  if (member.isOnline) return `Online since ${presenceTime(member.onlineSince)}`;
  if (member.leftAt) return `Left ${presenceTime(member.leftAt)}`;
  if (member.lastSeenAt) return `Last seen ${presenceTime(member.lastSeenAt)}`;
  return 'No activity recorded yet';
}

export function useRoomPresence({ apiBase, accessKey, deviceId, roomId, name, client }) {
  const [snapshot, setSnapshot] = useState({ roomId: null, members: [] });
  useEffect(() => {
    if (!accessKey || !deviceId || !roomId || !client) return undefined;
    let stopped = false;
    let sequence = 0;
    let lastSuccess = 0;
    let appliedSequence = 0;
    let connected = client.wsConnection?.isHealthy !== false;
    const sessionId = crypto.randomUUID();
    const send = async (leaving = false) => {
      const online = !leaving && !document.hidden && navigator.onLine && connected;
      if (!stopped && lastSuccess && Date.now() - lastSuccess >= 45000) {
        setSnapshot({ roomId, members: [] });
      }
      const reportSequence = ++sequence;
      try {
        const response = await fetch(`${apiBase}/api/room-presence`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessKey, deviceId, roomId, sessionId, sequence: reportSequence, online, name }),
          keepalive: true,
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('Presence unavailable');
        const data = await response.json();
        if (!stopped && !leaving && reportSequence > appliedSequence) {
          appliedSequence = reportSequence;
          lastSuccess = Date.now();
          setSnapshot({ roomId, members: data.members || [] });
        }
      } catch {
        // Never keep displaying an old green status through an outage.
        if (!stopped && Date.now() - lastSuccess >= 45000) {
          setSnapshot({ roomId, members: [] });
        }
      }
    };
    const refresh = () => { void send(); };
    const leave = () => { void send(true); };
    const subscription = client.on('connection.changed', event => {
      connected = Boolean(event.online);
      refresh();
    });
    refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      stopped = true;
      leave();
      clearInterval(timer);
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [apiBase, accessKey, deviceId, roomId, name, client]);
  return snapshot.roomId === roomId ? snapshot.members : [];
}
