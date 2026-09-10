import { useEffect, useState } from "react";

const tabs = [
  ["search", "⌕", "Search"],
  ["saved", "★", "Saved"],
  ["media", "▧", "Media"],
  ["members", "♙", "Members"],
  ["status", "◉", "Status"],
  ["settings", "⚙", "Settings"],
];

function messageTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function messageSummary(message) {
  return message?.text || (message?.attachments?.length ? "Media attachment" : "Message");
}

export default function SayUpV2Hub({
  open,
  onClose,
  channel,
  currentUserId,
  room,
  bookmarkedIds,
  onOpenMedia,
  onJumpToMessage,
}) {
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [muted, setMuted] = useState(false);
  const [appearance, setAppearance] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sayup_appearance")) || {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!channel) return undefined;
    const refresh = () => setVersion((value) => value + 1);
    const events = ["message.new", "message.updated", "message.deleted", "reaction.new", "reaction.deleted", "member.added", "member.removed"];
    events.forEach((eventName) => channel.on(eventName, refresh));
    return () => events.forEach((eventName) => channel.off(eventName, refresh));
  }, [channel]);

  const messages = (channel?.state?.messages || []).filter((message) => message.type !== "system");
  const members = Object.values(channel?.state?.members || {});
  const savedMessages = messages.filter((message) => bookmarkedIds.includes(message.id));
  const results = query.trim()
    ? messages.filter((message) => messageSummary(message).toLowerCase().includes(query.trim().toLowerCase()))
    : messages.slice(-20).reverse();
  const media = messages.flatMap((message) =>
    (message.attachments || []).map((attachment) => ({ message, attachment })),
  );

  const applyAppearance = (next) => {
    const value = { ...appearance, ...next };
    setAppearance(value);
    localStorage.setItem("sayup_appearance", JSON.stringify(value));
    document.documentElement.dataset.sayupTheme = value.theme || "light";
    document.documentElement.dataset.sayupWallpaper = value.wallpaper || "classic";
    document.documentElement.style.setProperty("--sayup-chat-scale", value.largeText ? "1.12" : "1");
  };

  useEffect(() => {
    applyAppearance(appearance);
    // Run once to restore the user's app appearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestNotifications = async () => {
    if (!("Notification" in window)) return alert("Notifications are not supported on this device.");
    const permission = await Notification.requestPermission();
    if (permission === "granted") new Notification("SayUp notifications are ready", { body: `Room ${room} can now alert you while SayUp is open.` });
  };

  const toggleMute = async (nextMuted) => {
    try {
      if (nextMuted) await channel.mute();
      else await channel.unmute();
      setMuted(nextMuted);
    } catch {
      alert("Notification preference could not be changed right now.");
    }
  };

  const publishStatus = async () => {
    const text = statusText.trim();
    if (!text) return;
    await channel.sendMessage({ text, sayup_status: true });
    setStatusText("");
    setTab("status");
  };

  if (!open) return null;

  const renderMessageRows = (items, emptyText) => (
    <div className="sayup-hub-list">
      {!items.length && <div className="sayup-hub-empty">{emptyText}</div>}
      {items.map((message) => (
        <button key={message.id} className="sayup-hub-message-row" onClick={() => onJumpToMessage(message.id)}>
          <span className="sayup-hub-row-avatar">{String(message.user?.name || "U").slice(0, 1).toUpperCase()}</span>
          <span className="sayup-hub-row-copy">
            <strong>{message.user?.name || "Member"}</strong>
            <small>{messageSummary(message)}</small>
          </span>
          <time>{messageTime(message.created_at)}</time>
        </button>
      ))}
    </div>
  );

  return (
    <div className="sayup-hub-backdrop" onPointerDown={onClose}>
      <aside className="sayup-hub" role="dialog" aria-modal="true" aria-label="SayUp tools" onPointerDown={(event) => event.stopPropagation()}>
        <header className="sayup-hub-header">
          <div><span>Room {room}</span><h2>SayUp</h2></div>
          <button onClick={onClose} aria-label="Close SayUp tools">×</button>
        </header>
        <nav className="sayup-hub-tabs" aria-label="Room tools">
          {tabs.map(([id, icon, label]) => (
            <button key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><b>{icon}</b><span>{label}</span></button>
          ))}
        </nav>
        <main className="sayup-hub-content">
          {tab === "search" && <>
            <h3>Find a message</h3>
            <input className="sayup-hub-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this room" autoFocus />
            {renderMessageRows(results, "No matching messages")}
          </>}
          {tab === "saved" && <>
            <h3>Saved messages</h3><p className="sayup-hub-help">Saved items always show the latest edited version.</p>
            {renderMessageRows(savedMessages, "Hold a message and tap Save to keep it here.")}
          </>}
          {tab === "media" && <>
            <h3>Private room media</h3><p className="sayup-hub-private">🔒 Media opens only inside SayUp. The app does not add it to your Photos or Gallery.</p>
            <div className="sayup-hub-media-grid">
              {!media.length && <div className="sayup-hub-empty">No shared media yet.</div>}
              {media.map(({ message, attachment }, index) => {
                const url = attachment.image_url || attachment.thumb_url || attachment.asset_url;
                const isVideo = attachment.type === "video" || String(attachment.mime_type || "").startsWith("video/");
                return <button key={`${message.id}-${index}`} onClick={() => onOpenMedia(message.attachments, index)} onContextMenu={(event) => event.preventDefault()}>
                  {url && !isVideo ? <img src={url} alt="Private attachment" draggable="false" /> : <span>{isVideo ? "▶ Video" : "▤ Document"}</span>}
                </button>;
              })}
            </div>
          </>}
          {tab === "members" && <>
            <h3>Room members <em>{members.length}</em></h3>
            <div className="sayup-hub-list">{members.map((member) => <div className="sayup-hub-member" key={member.user_id || member.user?.id}>
              <span className="sayup-hub-row-avatar">{String(member.user?.name || "U").slice(0, 1).toUpperCase()}</span>
              <span><strong>{member.user?.name || member.user_id}</strong><small>{member.user?.id === currentUserId ? "You · online" : "Room member"}</small></span>
            </div>)}</div>
            <p className="sayup-hub-help">Invite members using the same private Access Key and room number. Admin role management remains protected in the Admin app.</p>
          </>}
          {tab === "status" && <>
            <h3>Status updates</h3><p className="sayup-hub-help">Share a temporary-style update with this room.</p>
            <div className="sayup-status-compose"><input value={statusText} onChange={(event) => setStatusText(event.target.value)} placeholder="What’s happening?" maxLength={240} /><button onClick={publishStatus}>Share</button></div>
            {renderMessageRows(messages.filter((message) => message.sayup_status).slice().reverse(), "No status updates yet.")}
          </>}
          {tab === "settings" && <>
            <h3>App settings</h3>
            <div className="sayup-setting-group">
              <label><span><strong>Dark theme</strong><small>Comfortable in low light</small></span><input type="checkbox" checked={appearance.theme === "dark"} onChange={(e) => applyAppearance({ theme: e.target.checked ? "dark" : "light" })} /></label>
              <label><span><strong>Large chat text</strong><small>Improves accessibility</small></span><input type="checkbox" checked={Boolean(appearance.largeText)} onChange={(e) => applyAppearance({ largeText: e.target.checked })} /></label>
              <label><span><strong>Soft wallpaper</strong><small>A premium neutral chat background</small></span><input type="checkbox" checked={appearance.wallpaper === "soft"} onChange={(e) => applyAppearance({ wallpaper: e.target.checked ? "soft" : "classic" })} /></label>
              <label><span><strong>Mute this room</strong><small>Pause room notifications</small></span><input type="checkbox" checked={muted} onChange={(e) => toggleMute(e.target.checked)} /></label>
            </div>
            <button className="sayup-hub-primary" onClick={requestNotifications}>Enable notifications</button>
            <div className="sayup-hub-feature-cards"><div><b>Offline recovery</b><span>Drafts and queued sends recover automatically when your connection returns.</span></div><div><b>Private previews</b><span>SayUp avoids gallery downloads and keeps attachments in its own viewer.</span></div></div>
          </>}
        </main>
      </aside>
    </div>
  );
}
