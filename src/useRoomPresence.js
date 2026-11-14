import { mergeRoomPresence } from "./presenceState.js";
import { useEffect, useState } from 'react';

export function presenceTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export function presenceSummary(member) {
  if (!member) return 'Status unknown';
  if (member.isOnline) return member.onlineSince ? `Online since ${presenceTime(member.onlineSince)}` : 'Online';
  if (member.leftAt) return `Left ${presenceTime(member.leftAt)}`;
  if (member.lastSeenAt) return `Last seen ${presenceTime(member.lastSeenAt)}`;
  return typeof member.isOnline === 'boolean' ? 'Offline' : 'Status unknown';
}

export function useRoomPresence({ apiBase, accessKey, deviceId, roomId, name, client, channel }) {
  const [snapshot, setSnapshot] = useState({ roomId: null, members: [] });
  useEffect(() => {
    if (!roomId || !client) return undefined;
    let stopped = false;
    let sequence = 0;
    let lastSuccess = 0;
    let appliedSequence = 0;
    let connected = Boolean(client.wsFallback?.isHealthy?.() || client.wsConnection?.isHealthy !== false);
    const sessionId = crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,
      value => (Number(value) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(value) / 4).toString(16));
    let recordedMembers = [];
    const liveMembers = new Map();
    const revisions = new Map();
    let revision = 0, generation = 0, livePending, liveRetry, liveFailures = 0, liveRefreshAgain = false;
    const memberIds = () => new Set(Object.values(channel?.state?.members || {})
      .map(member => member.user_id || member.user?.id).filter(Boolean));
    const publish = () => {
      if (stopped) return;
      const ids = memberIds();
      const recorded = Date.now() - lastSuccess < 45000
        ? recordedMembers.filter(member => !channel || ids.has(member.userId)) : [];
      setSnapshot({ roomId, members: mergeRoomPresence(
        [...liveMembers.values()].filter(member => ids.has(member.userId)), recorded,
      ) });
    };
    const applyUser = (user, eventTime) => {
      if (!user?.id || !memberIds().has(user.id) || typeof user.online !== 'boolean') return;
      const previous = liveMembers.get(user.id);
      liveMembers.set(user.id, {
        userId: user.id, name: user.name || previous?.name || 'Room member',
        isOnline: user.online,
        onlineSince: user.online ? previous?.isOnline ? previous.onlineSince : eventTime || null : null,
        lastSeenAt: user.last_active || previous?.lastSeenAt || null,
      });
    };
    const refreshLive = () => {
      clearTimeout(liveRetry); liveRetry = undefined;
      if (stopped || !connected || !navigator.onLine || typeof client.queryUsers !== 'function') return Promise.resolve();
      if (livePending) { liveRefreshAgain = true; return livePending; }
      const requestRevision = revision, requestGeneration = generation;
      const ids = [...memberIds()].slice(0, 30);
      const task = async () => {
        try {
          if (!ids.length) throw new Error('Room members still loading');
          const data = await client.queryUsers({ id: { $in: ids } }, [], { presence: true, limit: 30 });
          if (stopped || generation !== requestGeneration) return;
          for (const user of data.users || []) {
            if ((revisions.get(user.id) || 0) <= requestRevision) applyUser(user);
          }
          liveFailures = 0;
          publish();
        } catch (error) {
          const status = Number(error?.status || error?.response?.status);
          if (!stopped && connected && !(status >= 400 && status < 500 && status !== 408 && status !== 429)) {
            liveRetry = setTimeout(refreshLive, Math.min(1000 * 2 ** Math.min(liveFailures++, 4), 15000));
            liveRetry?.unref?.();
          }
        }
      };
      livePending = task();
      const current = livePending;
      current.then(() => {
        if (livePending !== current) return;
        livePending = undefined;
        if (liveRefreshAgain || generation !== requestGeneration) {
          liveRefreshAgain = false;
          void refreshLive();
        }
      });
      return current;
    };
    const send = async (leaving = false) => {
      if (!accessKey || !deviceId) return;
      const online = !leaving && !document.hidden && navigator.onLine && connected;
      if (!stopped && lastSuccess && Date.now() - lastSuccess >= 45000) {
        recordedMembers = [];
        publish();
      }
      const reportSequence = ++sequence;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      timeout?.unref?.();
      try {
        const response = await fetch(`${apiBase}/api/room-presence`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessKey, deviceId, roomId, sessionId, sequence: reportSequence, online, name }),
          keepalive: true,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Presence unavailable');
        const data = await response.json();
        if (!stopped && !leaving && reportSequence > appliedSequence) {
          appliedSequence = reportSequence;
          lastSuccess = Date.now();
          recordedMembers = data.members || [];
          publish();
        }
      } catch {
        // Never keep displaying an old green status through an outage.
        if (!stopped && Date.now() - lastSuccess >= 45000) {
          recordedMembers = [];
          publish();
        }
      } finally { clearTimeout(timeout); }
    };
    const refresh = () => { void send(); };
    const leave = () => { void send(true); };
    const subscription = client.on('connection.changed', event => {
      connected = Boolean(event.online);
      if (!connected) { generation++; liveMembers.clear(); publish(); }
      else void refreshLive();
      refresh();
    });
    const liveSubscription = client.on('user.presence.changed', event => {
      if (!connected || !memberIds().has(event.user?.id)) return;
      revisions.set(event.user?.id, ++revision);
      applyUser(event.user, event.created_at);
      publish();
    });
    const recoveredSubscription = client.on('connection.recovered', () => { void refreshLive(); });
    const addedSubscription = channel?.on('member.added', () => { void refreshLive(); });
    const removedSubscription = channel?.on('member.removed', () => { publish(); void refreshLive(); });
    const resumeLive = () => { if (!document.hidden) void refreshLive(); };
    document.addEventListener('visibilitychange', resumeLive);
    window.addEventListener('online', resumeLive);
    void refreshLive();
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
      clearTimeout(liveRetry);
      subscription.unsubscribe();
      liveSubscription.unsubscribe();
      recoveredSubscription.unsubscribe();
      addedSubscription?.unsubscribe();
      removedSubscription?.unsubscribe();
      document.removeEventListener('visibilitychange', resumeLive);
      window.removeEventListener('online', resumeLive);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [apiBase, accessKey, deviceId, roomId, name, client, channel]);
  return snapshot.roomId === roomId ? snapshot.members : [];
}
