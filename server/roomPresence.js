// Presence means a recently confirmed, visible room session. A missing heartbeat
// is last-seen evidence, not an invented exact departure time.
export const PRESENCE_TTL_MS = 45000;
const activeSessions = (record, now) => Object.values(record.sessions || {})
  .filter(session => session.online && now - session.at < PRESENCE_TTL_MS);

export function reportRoomPresence(device, roomId, { sessionId, sequence, online, name }, now = Date.now()) {
  device.roomPresence ||= {};
  const record = device.roomPresence[roomId] ||= { sessions: {} };
  const previous = record.sessions[sessionId];
  if (previous && sequence <= previous.sequence) return;
  const wasOnline = activeSessions(record, now).length > 0;
  record.sessions[sessionId] = { sequence, online, at: now };
  record.name = String(name || record.name || 'Room member').slice(0, 80);
  if (online) {
    if (!wasOnline) record.onlineSince = new Date(now).toISOString();
    record.lastSeenAt = new Date(now).toISOString();
    record.leftAt = null;
  } else if (wasOnline && !activeSessions(record, now).length) {
    record.leftAt = new Date(now).toISOString();
  }
  // Retain recent sequence tombstones so delayed requests cannot resurrect tabs.
  for (const [id, session] of Object.entries(record.sessions)) {
    if (now - session.at > 24 * 60 * 60 * 1000) delete record.sessions[id];
  }
  const sessionIds = Object.keys(record.sessions).sort((a, b) => record.sessions[b].at - record.sessions[a].at);
  for (const id of sessionIds.slice(32)) delete record.sessions[id];
}

export function roomPresenceSnapshot(devices, roomId, now = Date.now()) {
  return devices.filter(device => device.status === 'active' && device.roomPresence?.[roomId])
    .map(device => {
      const record = device.roomPresence[roomId];
      return {
        userId: device.streamUserId,
        name: record.name,
        isOnline: activeSessions(record, now).length > 0,
        onlineSince: record.onlineSince || null,
        lastSeenAt: record.lastSeenAt || null,
        leftAt: record.leftAt || null,
      };
    });
}
