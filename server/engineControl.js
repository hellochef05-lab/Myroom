export function createEngineControl({ readDB, writeDB, notifyOff, revokeTokens }) {
  let changing = false;
  let starting = false;

  return {
    enabled() { return !starting && readDB().engineEnabled !== false; },
    async update(enabled) {
      if (changing) return { status: 409, error: "An Engine change is already in progress." };
      changing = true;
      const db = readDB();
      const wasEnabled = db.engineEnabled !== false;
      try {
        if (!enabled) {
          if (wasEnabled || !db.engineTokensRevokedBefore) {
            db.engineTokensRevokedBefore = (Math.floor(Date.now() / 1000) + 1) * 1000;
          }
          db.engineEnabled = false;
          notifyOff();
        } else {
          starting = !wasEnabled;
          db.engineEnabled = true;
        }
        if (!await writeDB(db)) throw new Error("Engine setting did not save");
        if (!enabled) {
          try {
            const ids = [...new Set(db.devices.map(device => device.streamUserId).filter(Boolean))];
            await revokeTokens(ids, new Date(db.engineTokensRevokedBefore));
          } catch (error) {
            console.error("Could not revoke existing chat sessions:", error.message);
            return { enabled: false, warning: "The Engine is off. Retry shutdown to finish closing older chat sessions." };
          }
        }
        return { enabled };
      } catch (error) {
        console.error("Could not save the Engine setting:", error.message);
        if (starting) readDB().engineEnabled = false;
        return { status: 503, enabled: readDB().engineEnabled !== false, error: "Could not save the Engine setting. Try again." };
      } finally {
        starting = false;
        changing = false;
      }
    },
  };
}
