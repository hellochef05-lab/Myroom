import { createContext, createElement, useContext } from 'react';
import { useRoomPresence } from './useRoomPresence.js';
const RoomPresenceContext = createContext([]);
export function useRoomPresenceMembers() { return useContext(RoomPresenceContext); }
// Keep the heartbeat state out of App: presence updates must not remount the
// existing message renderer, reset drafts, or move the message list.
export function RoomPresenceProvider({ children, ...config }) {
  const members = useRoomPresence(config);
  return createElement(RoomPresenceContext.Provider, { value: members }, children);
}
