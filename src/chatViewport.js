// Use one coordinate space: Safari's visible viewport. Mixing its height with
// a stale layout/root height can shrink the chat twice during keyboard changes.
export function getChatViewportGeometry(viewport, fallbackHeight) {
  const height = viewport?.height > 0 ? viewport.height : fallbackHeight;
  const top = Number.isFinite(viewport?.offsetTop)
    ? Math.max(0, viewport.offsetTop)
    : 0;
  return {
    height: Number.isFinite(height) && height > 0 ? height : null,
    top,
  };
}
