// One membership check per socket connection. A call/answer can reuse the
// membership established while the room was opening, without another RTT.
export function createRoomJoiner(socket, roomId, {
  onReady = () => {}, timeoutMs = 5000,
} = {}) {
  let joinedSocketId = null;
  let pending = null;
  let finishPending;
  let disposed = false;
  const invalidate = () => {
    joinedSocketId = null;
    finishPending?.(false);
    onReady(false);
  };
  socket.on('disconnect', invalidate);
  return {
    ensure() {
      if (disposed) return Promise.resolve(false);
      if (socket.connected && socket.id && socket.id === joinedSocketId) {
        return Promise.resolve(true);
      }
      if (pending) return pending;
      pending = new Promise(resolve => {
        let settled = false;
        let joiningSocketId;
        const finish = ready => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.off('connect', join);
          finishPending = null;
          joinedSocketId = ready ? joiningSocketId : null;
          onReady(ready);
          resolve(ready);
        };
        const join = () => {
          if (settled || !socket.connected) return;
          joiningSocketId = socket.id;
          socket.timeout(timeoutMs).emit('join-room', { roomId }, (error, result) => {
            finish(!error && Boolean(result?.ok) && socket.connected && socket.id === joiningSocketId);
          });
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        finishPending = finish;
        if (socket.connected) join();
        else {
          socket.once('connect', join);
          socket.connect();
        }
      });
      const result = pending;
      result.then(() => { if (pending === result) pending = null; });
      return result;
    },
    dispose() {
      disposed = true;
      finishPending?.(false);
      socket.off('disconnect', invalidate);
    },
  };
}

export const CALL_SIGNAL_ACK_TIMEOUT_MS = 4000;
