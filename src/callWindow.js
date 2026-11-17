import { useLayoutEffect, useRef, useState } from 'react';

const margin = 8;
export const dragThreshold = 6;
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

export function clampCallWindow(position, room, viewport, size) {
  const left = Math.max(room.left, viewport.left) + margin;
  const top = Math.max(room.top, viewport.top) + margin;
  const right = Math.min(room.right, viewport.right) - margin - size.width;
  const bottom = Math.min(room.bottom, viewport.bottom) - margin - size.height;
  return {
    x: clamp(position.x, left - room.left, right - room.left),
    y: clamp(position.y, top - room.top, bottom - room.top),
  };
}

function measurePosition(anchor, panel) {
  if (!anchor || !panel) return null;
  const origin = anchor.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  return { x: rect.left - origin.left, y: rect.top - origin.top };
}

function constrainWindow(position, anchor, panel) {
  if (!anchor?.parentElement || !panel) return position;
  const origin = anchor.getBoundingClientRect();
  const room = anchor.parentElement.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const viewportRect = {
    left, top,
    right: left + (viewport?.width ?? window.innerWidth),
    bottom: top + (viewport?.height ?? window.innerHeight),
  };
  const dx = origin.left - room.left;
  const dy = origin.top - room.top;
  const bounded = clampCallWindow({ x: position.x + dx, y: position.y + dy },
    room, viewportRect, panel.getBoundingClientRect());
  return { x: bounded.x - dx, y: bounded.y - dy };
}

export function useMovableCallWindow(enabled) {
  const windowRef = useRef(null);
  const roomRef = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const [position, setPosition] = useState(null);
  const constrain = next => constrainWindow(next, roomRef.current, windowRef.current);
  const currentPosition = () => measurePosition(roomRef.current, windowRef.current);

  useLayoutEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const room = roomRef.current;
    const panel = windowRef.current;
    const adjust = () => {
      const next = measurePosition(room, panel);
      if (!next) return;
      const bounded = constrainWindow(next, room, panel);
      if (Math.abs(bounded.x - next.x) > 0.5 || Math.abs(bounded.y - next.y) > 0.5) setPosition(bounded);
    };
    const frame = window.requestAnimationFrame(adjust);
    window.addEventListener('resize', adjust);
    viewport?.addEventListener('resize', adjust);
    viewport?.addEventListener('scroll', adjust);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(adjust) : null;
    if (panel) observer?.observe(panel);
    if (room?.parentElement) observer?.observe(room.parentElement);
    return () => {
      gesture.current = null;
      suppressClick.current = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', adjust);
      viewport?.removeEventListener('resize', adjust);
      viewport?.removeEventListener('scroll', adjust);
      observer?.disconnect();
    };
  }, [enabled]);

  const finish = event => {
    if (gesture.current?.id !== event.pointerId) return;
    suppressClick.current = gesture.current.dragging;
    gesture.current = null;
  };

  const controls = {
    onPointerDown(event) {
      if (event.button !== 0 || gesture.current) return;
      const start = currentPosition();
      if (!start) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, start, x: event.clientX, y: event.clientY, dragging: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event) {
      const drag = gesture.current;
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.dragging && Math.hypot(dx, dy) < dragThreshold) return;
      drag.dragging = true;
      setPosition(constrain({ x: drag.start.x + dx, y: drag.start.y + dy }));
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onKeyDown(event) {
      const moves = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
      if (!Object.prototype.hasOwnProperty.call(moves, event.key)) return;
      const start = currentPosition();
      if (!start) return;
      event.preventDefault();
      const [x, y] = moves[event.key];
      setPosition(constrain({ x: start.x + x, y: start.y + y }));
    },
  };

  return {
    windowRef, roomRef, controls,
    style: position ? { '--call-window-x': `${position.x}px`, '--call-window-y': `${position.y}px`, '--call-window-right': 'auto' } : undefined,
    consumeDragClick(event) {
      if (!event.detail || !suppressClick.current) return false;
      suppressClick.current = false;
      return true;
    },
    reset() { setPosition(null); },
  };
}
