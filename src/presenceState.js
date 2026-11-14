export function mergeRoomPresence(liveMembers, recordedMembers) {
  const merged = new Map(recordedMembers.map(member => [member.userId, member]));
  for (const live of liveMembers) {
    const recorded = merged.get(live.userId) || {};
    const hasLiveStatus = typeof live.isOnline === 'boolean';
    const times = [live.lastSeenAt, recorded.lastSeenAt].filter(value => value && Number.isFinite(new Date(value).getTime()));
    const lastSeenAt = times.sort((a, b) => new Date(b) - new Date(a))[0] || null;
    merged.set(live.userId, {
      ...recorded, ...live,
      isOnline: hasLiveStatus ? live.isOnline : recorded.isOnline,
      onlineSince: live.isOnline
        ? live.onlineSince || (recorded.isOnline ? recorded.onlineSince : null)
        : recorded.onlineSince || null,
      lastSeenAt,
      // A live offline status confirms state, not an exact departure time.
      leftAt: hasLiveStatus ? null : recorded.leftAt,
    });
  }
  return [...merged.values()];
}
