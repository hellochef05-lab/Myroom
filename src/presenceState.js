export function mergeRoomPresence(liveMembers, recordedMembers) {
  const merged = new Map(liveMembers.map(member => [member.userId, member]));
  // Stream tracks the chat connection, while the heartbeat tracks this room.
  for (const member of recordedMembers) merged.set(member.userId, member);
  return [...merged.values()];
}
