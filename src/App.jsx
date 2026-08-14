import { useEffect, useMemo, useRef, useState } from "react";
import { StreamChat } from "stream-chat";
import {
  Attachment,
  Chat,
  Channel,
  MessageInput,
  MessageList,
  Thread,
  Window,
  MessageSimple,
  TypingIndicator,
  useMessageContext,
} from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";
import "./App.css";

import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  PhoneOff,
  Video,
  SwitchCamera,
} from "lucide-react";
import { io } from "socket.io-client";
const isMobile =
  typeof window !== "undefined" && window.innerWidth <= 768;

const apiKey = import.meta.env.VITE_STREAM_API_KEY;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function normaliseIdentifier(value, fallback = "item") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  return cleaned || fallback;
}

function createPrivateRoomId(accessKey, roomCode) {
  return `key_${normaliseIdentifier(accessKey, "unknown")}_room_${normaliseIdentifier(roomCode, "room")}`;
}

function createStreamUserId(accessKey, displayName, deviceId) {
  const deviceSuffix = normaliseIdentifier(deviceId, "device").slice(-18);
  return `key_${normaliseIdentifier(accessKey, "unknown")}_user_${normaliseIdentifier(displayName, "guest")}_${deviceSuffix}`;
}

const DEFAULT_API_TIMEOUT_MS = 25000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(url, options = {}, config = {}) {
  const { retries = 2, timeoutMs = DEFAULT_API_TIMEOUT_MS } = config;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status >= 500 && attempt < retries) {
        await wait(700 * (attempt + 1));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      if (attempt < retries) {
        await wait(700 * (attempt + 1));
        continue;
      }
    }
  }

  if (lastError?.name === "AbortError") {
    throw new Error("Network is slow. Please wait and try again.");
  }

  throw lastError || new Error("Network request failed. Please check your internet connection.");
}

function getDeviceId() {
  let deviceId = localStorage.getItem("device_id");

  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("device_id", deviceId);
  }

  return deviceId;
}

function getDeviceName() {
  return navigator.userAgent || "Unknown Device";
}

function getClientLocationInfo() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const locale = navigator.language || "";
  const region = locale.includes("-") ? locale.split("-").pop().toUpperCase() : "";
  const regionNames = typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
  let country = region && regionNames ? regionNames.of(region) : "Unknown";

  if (timezone === "Asia/Dubai") country = "United Arab Emirates";
  if (!country) country = "Unknown";

  return {
    country,
    timezone,
    platform: navigator.userAgentData?.platform || navigator.platform || "",
  };
}


let turnServers = [];
try {
  const raw = import.meta.env.VITE_TURN_SERVERS;
  if (raw && raw.trim().length) {
    turnServers = JSON.parse(raw);
  }
} catch (err) {
  console.warn("failed to parse VITE_TURN_SERVERS", err);
  turnServers = [];
}

function formatTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function roundActionButton(background) {
  return {
    width: 58,
    height: 58,
    borderRadius: 999,
    border: "none",
    background,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 30px rgba(0,0,0,0.22)",
  };
}

function CallHeader({
  room,
  onStartAudio,
  onStartVideo,
  inCall,
  callType,
  joinedRoom,
  onExitRoom,
  onOpenSupport,
}) {
  const compact = typeof window !== "undefined" && window.innerWidth <= 768;
  const veryCompact = typeof window !== "undefined" && window.innerWidth <= 430;
  const roomInitial = String(room || "R").trim().slice(0, 1).toUpperCase();

  const actions = [
    {
      label: "Call",
      title: "Start audio call",
      onClick: onStartAudio,
      disabled: !joinedRoom || inCall,
      background: "rgba(255,255,255,0.18)",
      icon: <Phone size={compact ? 17 : 21} color="#fff" />,
    },
    {
      label: "Video",
      title: "Start video call",
      onClick: onStartVideo,
      disabled: !joinedRoom || inCall,
      background: "rgba(255,255,255,0.22)",
      icon: <Video size={compact ? 17 : 21} color="#fff" />,
    },
    {
      label: "Exit",
      title: "Exit room",
      onClick: onExitRoom,
      disabled: false,
      background: "linear-gradient(180deg, #ff5a5f 0%, #e9272f 100%)",
      icon: <PhoneOff size={compact ? 17 : 21} color="#fff" />,
    },
  ];

  return (
    <header
      className="private-room-call-header"
      style={{
        minHeight: compact ? 76 : 92,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: compact ? 6 : 16,
        padding: compact ? "8px 8px" : "12px 20px",
        background:
          "linear-gradient(110deg, #075e54 0%, #087f70 56%, #0797a8 100%)",
        color: "#fff",
        borderBottom: "1px solid rgba(255,255,255,0.20)",
        width: "100%",
        flexShrink: 0,
        zIndex: 220,
        position: "relative",
        boxSizing: "border-box",
        boxShadow: "0 8px 24px rgba(15,118,110,0.18)",
        overflow: "visible",
      }}
    >
      <div
        className="private-room-header-user"
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          flex: "1 1 auto",
          gap: compact ? 7 : 13,
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={onExitRoom}
          aria-label="Back to login"
          title="Back to login"
          style={{
            width: compact ? 34 : 42,
            height: compact ? 40 : 46,
            border: "none",
            borderRadius: 999,
            background: "rgba(255,255,255,0.10)",
            color: "#fff",
            fontSize: compact ? 27 : 32,
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ‹
        </button>

        {!veryCompact && (
          <div
            style={{
              position: "relative",
              width: compact ? 42 : 58,
              height: compact ? 42 : 58,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.96)",
              color: "#0f766e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: compact ? 18 : 25,
              fontWeight: 950,
              boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
              flexShrink: 0,
            }}
          >
            {roomInitial}
            <span
              style={{
                position: "absolute",
                right: -1,
                bottom: 1,
                width: compact ? 9 : 12,
                height: compact ? 9 : 12,
                borderRadius: "50%",
                background: joinedRoom ? "#4ade80" : "#fbbf24",
                border: "2px solid #fff",
              }}
            />
          </div>
        )}

        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              fontWeight: 950,
              fontSize: compact ? 15 : 22,
              lineHeight: 1.1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Room {room}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: compact ? 10 : 13,
              opacity: 0.96,
              marginTop: 4,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: joinedRoom ? "#4ade80" : "#fbbf24",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {inCall
                ? callType === "video"
                  ? "Video call active"
                  : "Audio call active"
                : joinedRoom
                  ? "Online"
                  : "Connecting..."}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="private-room-support-button"
        onClick={onOpenSupport}
        title="Open room support"
        aria-label="Open room support"
      >
        Support
      </button>

      <div
        className="private-room-header-actions"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: compact ? 4 : 12,
          flex: "0 0 auto",
          minWidth: 0,
        }}
      >
        {actions.map((action) => (
          <div
            key={action.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={action.onClick}
              title={action.title}
              aria-label={action.title}
              disabled={action.disabled}
              style={{
                width: compact ? 38 : 52,
                height: compact ? 38 : 52,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.28)",
                background: action.background,
                cursor: action.disabled ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow:
                  action.label === "Exit"
                    ? "0 7px 18px rgba(185,28,28,0.34)"
                    : "0 7px 18px rgba(0,0,0,0.15)",
                opacity: action.disabled ? 0.48 : 1,
                padding: 0,
              }}
            >
              {action.icon}
            </button>
            <span
              style={{
                display: "block",
                fontSize: compact ? 9 : 12,
                lineHeight: 1,
                color: "#fff",
                fontWeight: 900,
                textShadow: "0 1px 2px rgba(0,0,0,0.20)",
              }}
            >
              {action.label}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}

function FullScreenCallOverlay({
  visible,
  inCall,
  incoming,
  callType,
  remoteName,
  connectionMessage,
  localVideoRef,
  remoteVideoRef,
  remoteAudioRef,
  onAnswer,
  onDecline,
  onHangup,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
  onShareScreen,
  muted,
  cameraOff,
  remoteStream,
  facingMode,
}) {
  if (!visible) return null;

  const isVideo = callType === "video";

  return (
    <div
      className={`video-call-overlay ${isVideo ? "is-video" : "is-audio"}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: isVideo ? "#000" : "linear-gradient(180deg, #0b3d36, #111)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: "none" }}
      />

      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          right: 18,
          zIndex: 3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#fff",
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {remoteName || "Contact"}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            {incoming
              ? incoming.callType === "video"
                ? "Incoming video call"
                : "Incoming audio call"
              : inCall
                ? isVideo
                  ? "Video call connected"
                  : "Audio call connected"
                : "Calling..."}
          </div>
        </div>
      </div>

      {connectionMessage && (
        <div
          style={{
            position: "absolute",
            top: 78,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 4,
          }}
        >
          {connectionMessage}
        </div>
      )}

      {isVideo ? (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              background: "#000",
            }}
          />

          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              position: "absolute",
              right: 16,
              bottom: 110,
              width: 130,
              height: 180,
              objectFit: "cover",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.22)",
              background: "#111",
              zIndex: 2,
              display: cameraOff ? "none" : "block",
            }}
          />
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            color: "#fff",
            gap: 18,
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "#1f6d61",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 42,
              fontWeight: 700,
            }}
          >
            {(remoteName || "C").slice(0, 1).toUpperCase()}
          </div>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {remoteStream ? "Connected" : "Connecting..."}
          </div>
        </div>
      )}

      {incoming && !inCall && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 80,
            transform: "translateX(-50%)",
            display: "flex",
            gap: 18,
            zIndex: 3,
          }}
        >
          <button
            onClick={onDecline}
            style={roundActionButton("#B00020")}
            title="Decline"
          >
            <PhoneOff size={22} color="#fff" />
          </button>
          <button
            onClick={onAnswer}
            style={roundActionButton("#25D366")}
            title="Answer"
          >
            <Phone size={22} color="#fff" />
          </button>
        </div>
      )}

      {!incoming && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 34,
            transform: "translateX(-50%)",
            display: "flex",
            gap: 14,
            zIndex: 3,
            alignItems: "center",
          }}
        >
          <button
            onClick={onToggleMute}
            style={roundActionButton(
              muted ? "#455A64" : "rgba(255,255,255,0.18)"
            )}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <MicOff size={20} color="#fff" />
            ) : (
              <Mic size={20} color="#fff" />
            )}
          </button>

          {isVideo && (
            <>
              <button
                onClick={onToggleCamera}
                style={roundActionButton(
                  cameraOff ? "#455A64" : "rgba(255,255,255,0.18)"
                )}
                title={cameraOff ? "Turn camera on" : "Turn camera off"}
              >
                {cameraOff ? (
                  <CameraOff size={20} color="#fff" />
                ) : (
                  <Camera size={20} color="#fff" />
                )}
              </button>

              <button
                onClick={onSwitchCamera}
                style={roundActionButton("rgba(255,255,255,0.18)")}
                title={facingMode === "environment" ? "Switch to front camera" : "Switch to back camera"}
                aria-label={facingMode === "environment" ? "Switch to front camera" : "Switch to back camera"}
              >
                <SwitchCamera size={21} color="#fff" />
              </button>
            </>
          )}

          <button
            onClick={onHangup}
            style={roundActionButton("#B00020")}
            title="Hang up"
          >
            <PhoneOff size={22} color="#fff" />
          </button>
        </div>
      )}
    </div>
  );
}


function SupportModal({
  open,
  mode,
  form,
  onChange,
  onClose,
  onSubmit,
  sending,
  tickets = [],
  loading = false,
  replyText = "",
  setReplyText = () => {},
  onReply = () => {},
}) {
  if (!open) return null;

  const isRoom = mode === "room";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2500,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          background: "#ffffff",
          borderRadius: 24,
          padding: 20,
          boxShadow: "0 24px 70px rgba(0,0,0,0.32)",
          boxSizing: "border-box",
        }}
      >
        <h2
          style={{
            margin: "0 0 6px",
            color: "#17343a",
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {isRoom ? "Room Support" : "Contact Support"}
        </h2>

        <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: 14 }}>
          {isRoom
            ? "Tell us what is wrong in this room."
            : "Send a message before login or for subscription help."}
        </p>

        {!isRoom && (
          <>
            <input
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Your name"
              style={supportInputStyle}
            />

            <input
              value={form.contact}
              onChange={(e) => onChange({ contact: e.target.value })}
              placeholder="Phone or email"
              style={supportInputStyle}
            />

            <input
              value={form.accessKey}
              onChange={(e) => onChange({ accessKey: e.target.value })}
              placeholder="Access Key, optional"
              style={supportInputStyle}
            />
          </>
        )}

        <select
  value={form.issueType}
  onChange={(e) => onChange({ issueType: e.target.value })}
  style={{
    width: "100%",
    marginTop: 10,
    padding: 12,
    borderRadius: 999,
    border: "1px solid #d1d5db",
    background: "#f8fafc",
    boxSizing: "border-box",
  }}

        >
          {isRoom ? (
            <>
              <option>Room issue</option>
              <option>Technical issue</option>
              <option>Device issue</option>
              <option>Access Key issue</option>
              <option>Other</option>
            </>
          ) : (
            <>
              <option>I want to buy a subscription</option>
              <option>Payment issue</option>
              <option>Access Key not received</option>
              <option>Login problem</option>
              <option>Subscription renewal</option>
              <option>Device reset request</option>
              <option>Other</option>
            </>
          )}
        </select>
{tickets.length > 0 && (
  <div
    style={{
      marginTop: 12,
      marginBottom: 12,
      padding: 12,
      borderRadius: 14,
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      maxHeight: 260,
      overflowY: "auto",
    }}
  >
    <div style={{ fontWeight: 900, marginBottom: 10 }}>
      Support Conversation
    </div>

    {tickets
  .filter(
    (ticket) =>
      ticket.status !== "closed" &&
      ticket.status !== "solved" &&
      ticket.status !== "archived"
  )
  .map((ticket) => (
      <div
        key={ticket.id}
        style={{
          marginBottom: 14,
          paddingBottom: 12,
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
          Ticket: {ticket.status} · {ticket.issueType || "Support"}
        </div>

        {(ticket.messages || []).map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: 8,
              padding: 10,
              borderRadius: 12,
              background: msg.senderType === "admin" ? "#ecfdf5" : "#eef2ff",
              color: "#0f172a",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 4 }}>
              {msg.senderType === "admin" ? "Admin" : "You"}
            </div>

            <div style={{ fontSize: 13 }}>{msg.message}</div>

            <div style={{ fontSize: 10, color: "#64748b", marginTop: 5 }}>
              {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ""}
            </div>
          </div>
        ))}

        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Reply to admin..."
          rows={2}
          style={{
            width: "100%",
            marginTop: 8,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            boxSizing: "border-box",
          }}
        />

        <button
          type="button"
          onClick={() => onReply(ticket.id)}
          disabled={sending}
          style={{
            marginTop: 8,
            width: "100%",
            padding: 10,
            borderRadius: 999,
            border: "none",
            background: "#0f766e",
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Reply to Support
        </button>
      </div>
    ))}
  </div>
)}
        <textarea
          value={form.message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="Write your message"
          rows={5}
          style={{
            ...supportInputStyle,
            height: "auto",
            borderRadius: 16,
            resize: "vertical",
            paddingTop: 12,
          }}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            onClick={onClose}
            disabled={sending}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#334155",
              fontWeight: 800,
              cursor: sending ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>

          <button
            onClick={onSubmit}
            disabled={sending}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(180deg, #34d399 0%, #059669 100%)",
              color: "#fff",
              fontWeight: 800,
              cursor: sending ? "not-allowed" : "pointer",
            }}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

const supportInputStyle = {
  width: "100%",
  height: 46,
  borderRadius: 999,
  border: "1px solid #dbe3ea",
  background: "#f8fafc",
  padding: "0 14px",
  fontSize: 14,
  outline: "none",
  color: "#0f172a",
  boxSizing: "border-box",
  marginBottom: 10,
};

const adminInputStyle = {
  width: "100%",
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
  color: "#0f172a",
  boxSizing: "border-box",
  marginBottom: 10,
};

const adminButtonStyle = {
  width: "100%",
  minHeight: 44,
  borderRadius: 12,
  border: "none",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  padding: "10px 12px",
};

const adminCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 18,
  background: "#f8fafc",
  boxSizing: "border-box",
};

function WebRTCCall({
  roomId,
  displayRoomId,
  myName,
  onExitRoom,
  onOpenSupport,
}) {
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const iceQueueRef = useRef([]);
  const acceptedRef = useRef(false);
  const isCallerRef = useRef(false);
  const disconnectTimeoutRef = useRef(null);
  const callActiveRef = useRef(false);
  const userMutedRef = useRef(false);
  const audioRepairInFlightRef = useRef(false);
  const audioWatchdogRef = useRef(null);
  const lastAudioBytesSentRef = useRef(null);
  const stagnantAudioChecksRef = useRef(0);
  const lastAudioRepairAtRef = useRef(0);

  const [joinedRoom, setJoinedRoom] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [facingMode, setFacingMode] = useState("user");
  const [remoteName, setRemoteName] = useState("Contact");
  const [connectionMessage, setConnectionMessage] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const preferredAudioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };

  const findSenderByKind = (pc, kind) =>
    pc?.getSenders?.().find((sender) => sender.track?.kind === kind) || null;

  const installLocalStream = (stream) => {
    localStreamRef.current = stream;

    if (callType === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
      localVideoRef.current.autoplay = true;
      localVideoRef.current.play?.().catch(() => {});
    }
  };

  const replaceLocalAudioTrack = async (audioTrack, audioStream) => {
    const pc = pcRef.current;
    if (!pc || !audioTrack) return false;

    audioTrack.enabled = !userMutedRef.current;

    const sender = findSenderByKind(pc, "audio");
    if (sender) {
      await sender.replaceTrack(audioTrack);
    } else {
      pc.addTrack(audioTrack, audioStream);
    }

    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getAudioTracks().forEach((oldTrack) => {
        if (oldTrack.id !== audioTrack.id) {
          currentStream.removeTrack(oldTrack);
          oldTrack.onended = null;
          oldTrack.onmute = null;
          oldTrack.stop();
        }
      });
      if (!currentStream.getAudioTracks().some((track) => track.id === audioTrack.id)) {
        currentStream.addTrack(audioTrack);
      }
      installLocalStream(currentStream);
    } else {
      installLocalStream(audioStream);
    }

    return true;
  };

  const repairMicrophone = async (reason = "watchdog", force = false) => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") return false;
    if (!callActiveRef.current && !force) return false;
    if (userMutedRef.current) return true;
    if (audioRepairInFlightRef.current) return false;

    const now = Date.now();
    if (!force && now - lastAudioRepairAtRef.current < 5000) return false;

    const currentTrack = localStreamRef.current?.getAudioTracks?.()[0];
    const sender = findSenderByKind(pc, "audio");
    const healthy =
      currentTrack &&
      currentTrack.readyState === "live" &&
      currentTrack.enabled &&
      sender?.track?.id === currentTrack.id;

    if (healthy && !force) return true;

    audioRepairInFlightRef.current = true;
    lastAudioRepairAtRef.current = now;

    try {
      console.warn(`Repairing microphone (${reason})`);
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: preferredAudioConstraints,
        video: false,
      });
      const micTrack = micStream.getAudioTracks()[0];
      if (!micTrack) throw new Error("No microphone track returned");

      micTrack.onended = () => {
        if (callActiveRef.current && !userMutedRef.current) {
          window.setTimeout(() => repairMicrophone("track-ended", true), 250);
        }
      };

      micTrack.onmute = () => {
        if (callActiveRef.current && !userMutedRef.current) {
          window.setTimeout(() => {
            const activeTrack = localStreamRef.current?.getAudioTracks?.()[0];
            if (activeTrack?.muted) repairMicrophone("track-muted", true);
          }, 1500);
        }
      };

      await replaceLocalAudioTrack(micTrack, micStream);
      lastAudioBytesSentRef.current = null;
      stagnantAudioChecksRef.current = 0;
      setConnectionMessage("");
      return true;
    } catch (err) {
      console.error("Microphone repair failed:", err);
      setConnectionMessage("Microphone reconnecting...");
      return false;
    } finally {
      audioRepairInFlightRef.current = false;
    }
  };

  const cleanupCall = () => {
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }

    callActiveRef.current = false;
    userMutedRef.current = false;
    lastAudioBytesSentRef.current = null;
    stagnantAudioChecksRef.current = 0;
    if (audioWatchdogRef.current) {
      clearInterval(audioWatchdogRef.current);
      audioWatchdogRef.current = null;
    }

    setConnectionMessage("");
    setInCall(false);
    setIncoming(null);
    setCallType(null);
    setMuted(false);
    setCameraOff(false);
    setFacingMode("user");
    setRemoteName("Contact");

    acceptedRef.current = false;
    isCallerRef.current = false;
    pendingOfferRef.current = null;
    iceQueueRef.current = [];

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }

    setRemoteStream(null);

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  };

  const createPC = () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        ...turnServers,
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    });

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      socketRef.current?.emit("signal", {
        roomId,
        data: { type: "ice", candidate: event.candidate },
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setConnectionMessage("");

        if (disconnectTimeoutRef.current) {
          clearTimeout(disconnectTimeoutRef.current);
          disconnectTimeoutRef.current = null;
        }
        return;
      }

      if (pc.connectionState === "disconnected") {
        setConnectionMessage("Reconnecting...");

        if (disconnectTimeoutRef.current) {
          clearTimeout(disconnectTimeoutRef.current);
        }

        disconnectTimeoutRef.current = setTimeout(() => {
          cleanupCall();
        }, 10000);

        return;
      }

      if (pc.connectionState === "failed") {
        setConnectionMessage("Connection failed");
        cleanupCall();
        return;
      }

      if (pc.connectionState === "closed") {
        cleanupCall();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "checking" ||
        pc.iceConnectionState === "disconnected"
      ) {
        setConnectionMessage("Weak connection");
        return;
      }

      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        setConnectionMessage("");
        return;
      }

      if (pc.iceConnectionState === "failed") {
        setConnectionMessage("Connection failed");
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const startLocalMedia = async (type) => {
    let pc = pcRef.current;
    if (!pc) {
      pc = createPC();
    }

    const constraints =
      type === "video"
        ? {
            audio: preferredAudioConstraints,
            video: { facingMode: { ideal: facingMode } },
          }
        : { audio: preferredAudioConstraints, video: false };

    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.error("getUserMedia failed:", err);
      alert(
        "Microphone/Camera access failed. Please allow permissions in your browser."
      );
      throw err;
    }

    localStreamRef.current = stream;

    for (const track of stream.getTracks()) {
      track.enabled = true;
      const sender = findSenderByKind(pc, track.kind);
      if (sender) {
        await sender.replaceTrack(track);
      } else {
        pc.addTrack(track, stream);
      }
    }

    const microphoneTrack = stream.getAudioTracks()[0];
    if (!microphoneTrack || microphoneTrack.readyState !== "live") {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Microphone did not start correctly");
    }

    microphoneTrack.onended = () => {
      if (callActiveRef.current && !userMutedRef.current) {
        window.setTimeout(() => repairMicrophone("track-ended", true), 250);
      }
    };

    microphoneTrack.onmute = () => {
      if (callActiveRef.current && !userMutedRef.current) {
        window.setTimeout(() => {
          const activeTrack = localStreamRef.current?.getAudioTracks?.()[0];
          if (activeTrack?.muted) repairMicrophone("track-muted", true);
        }, 1500);
      }
    };

    if (type === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
      localVideoRef.current.autoplay = true;
      localVideoRef.current.play?.().catch(() => {});
    } else if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    return stream;
  };

  const handleOffer = async (data) => {
    let pc = pcRef.current;
    if (!pc) {
      pc = createPC();
    }

    const nextCallType = data.callType || "audio";
    setCallType(nextCallType);
    setRemoteName(data.from || "Contact");

    await startLocalMedia(nextCallType);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    for (const candidate of iceQueueRef.current) {
      await pc.addIceCandidate(candidate).catch(console.warn);
    }
    iceQueueRef.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "answer", answer },
    });

    callActiveRef.current = true;
    setInCall(true);
    setIncoming(null);
  };

  const startOfferFlow = async (type) => {
    let pc = pcRef.current;
    if (!pc) {
      pc = createPC();
    }

    await startLocalMedia(type);

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: type === "video",
    });

    await pc.setLocalDescription(offer);

    socketRef.current?.emit("signal", {
      roomId,
      data: {
        type: "offer",
        offer,
        callType: type,
        from: myName,
      },
    });
  };

  useEffect(() => {
    const s = io(API_BASE, {
      transports: ["polling", "websocket"],
      reconnection: true,
    });

    socketRef.current = s;

    const joinCurrentRoom = () => {
      if (!roomId) return;

      s.emit("join-room", { roomId }, (res) => {
        if (res?.ok) {
          setJoinedRoom(true);
        } else {
          setJoinedRoom(false);
        }
      });
    };

    s.on("connect", () => {
      setJoinedRoom(false);
      joinCurrentRoom();
    });

    s.on("disconnect", () => {
      setJoinedRoom(false);
    });

    return () => {
      if (roomId) {
        s.emit("leave-room", { roomId });
      }
      s.disconnect();
      socketRef.current = null;
      setJoinedRoom(false);
    };
  }, [roomId]);

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onSignal = async (data) => {
      try {
        if (data.type === "call") {
          setIncoming({
            callType: data.callType,
            from: data.from || "Contact",
          });
          setRemoteName(data.from || "Contact");
          setCallType(data.callType || "audio");
          return;
        }

        if (data.type === "accept") {
          if (isCallerRef.current) {
            await startOfferFlow(data.callType || "audio");
          }
          return;
        }

        if (data.type === "offer") {
          if (!acceptedRef.current) {
            pendingOfferRef.current = data;
            return;
          }

          await handleOffer(data);
          return;
        }

        if (data.type === "answer") {
          const pc = pcRef.current;
          if (!pc) return;

          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

          for (const candidate of iceQueueRef.current) {
            await pc.addIceCandidate(candidate).catch(console.warn);
          }
          iceQueueRef.current = [];

          callActiveRef.current = true;
          setInCall(true);
          return;
        }

        if (data.type === "ice") {
          const pc = pcRef.current;
          if (!pc) return;

          const candidate = new RTCIceCandidate(data.candidate);

          if (!pc.remoteDescription) {
            iceQueueRef.current.push(candidate);
          } else {
            await pc.addIceCandidate(candidate).catch(console.warn);
          }
          return;
        }

        if (data.type === "hangup") {
          cleanupCall();
        }
      } catch (err) {
        console.error("Signal error:", err);
      }
    };

    s.on("signal", onSignal);
    return () => s.off("signal", onSignal);
  }, [roomId, myName]);

  const overlayVisible = Boolean(incoming || inCall);

  useEffect(() => {
    callActiveRef.current = inCall;

    if (!inCall) {
      if (audioWatchdogRef.current) {
        clearInterval(audioWatchdogRef.current);
        audioWatchdogRef.current = null;
      }
      lastAudioBytesSentRef.current = null;
      stagnantAudioChecksRef.current = 0;
      return undefined;
    }

    const checkOutgoingAudio = async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState === "closed" || userMutedRef.current) return;

      const track = localStreamRef.current?.getAudioTracks?.()[0];
      const sender = findSenderByKind(pc, "audio");

      if (!track || track.readyState !== "live" || !track.enabled || !sender?.track) {
        await repairMicrophone("missing-or-dead-track", true);
        return;
      }

      try {
        const stats = await pc.getStats();
        let bytesSent = null;
        stats.forEach((report) => {
          if (
            report.type === "outbound-rtp" &&
            !report.isRemote &&
            (report.kind === "audio" || report.mediaType === "audio")
          ) {
            bytesSent = Number(report.bytesSent || 0);
          }
        });

        if (bytesSent === null) return;

        if (lastAudioBytesSentRef.current === null || bytesSent > lastAudioBytesSentRef.current) {
          stagnantAudioChecksRef.current = 0;
        } else {
          stagnantAudioChecksRef.current += 1;
        }

        lastAudioBytesSentRef.current = bytesSent;

        if (stagnantAudioChecksRef.current >= 2) {
          stagnantAudioChecksRef.current = 0;
          await repairMicrophone("no-outbound-audio", true);
        }
      } catch (err) {
        console.warn("Audio watchdog stats check failed:", err);
      }
    };

    repairMicrophone("call-connected", false).catch(() => {});
    audioWatchdogRef.current = window.setInterval(checkOutgoingAudio, 4000);

    const recoverAfterResume = () => {
      if (document.visibilityState === "visible" && callActiveRef.current && !userMutedRef.current) {
        window.setTimeout(() => repairMicrophone("app-resumed", true), 500);
      }
    };

    document.addEventListener("visibilitychange", recoverAfterResume);
    window.addEventListener("focus", recoverAfterResume);

    return () => {
      document.removeEventListener("visibilitychange", recoverAfterResume);
      window.removeEventListener("focus", recoverAfterResume);
      if (audioWatchdogRef.current) {
        clearInterval(audioWatchdogRef.current);
        audioWatchdogRef.current = null;
      }
    };
  }, [inCall]);

  useEffect(() => {
    if (!remoteStream) return;
    if (!overlayVisible) return;

    const attachRemoteMedia = async () => {
      if (callType === "video") {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          remoteVideoRef.current.autoplay = true;
          remoteVideoRef.current.playsInline = true;
          remoteVideoRef.current.muted = true;
          remoteVideoRef.current.volume = 1;

          try {
            await remoteVideoRef.current.play();
          } catch (err) {
            console.error("Remote video play failed:", err);
          }
        }

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.autoplay = true;
          remoteAudioRef.current.playsInline = true;
          remoteAudioRef.current.muted = false;
          remoteAudioRef.current.volume = 1;

          try {
            await remoteAudioRef.current.play();
          } catch (err) {
            console.error("Remote audio play failed:", err);
          }
        }
      } else {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.autoplay = true;
          remoteAudioRef.current.playsInline = true;
          remoteAudioRef.current.muted = false;
          remoteAudioRef.current.volume = 1;

          try {
            await remoteAudioRef.current.play();
          } catch (err) {
            console.error("Remote audio play failed:", err);
          }
        }

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
      }
    };

    const id = setTimeout(() => {
      attachRemoteMedia();
    }, 100);

    return () => clearTimeout(id);
  }, [remoteStream, callType, overlayVisible]);

  useEffect(() => {
    if (!localStreamRef.current) return;
    if (!localVideoRef.current) return;
    if (!overlayVisible) return;

    if (callType === "video") {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
      localVideoRef.current.autoplay = true;

      localVideoRef.current.play().catch((err) => {
        console.error("Local video play failed:", err);
      });
    } else {
      localVideoRef.current.srcObject = null;
    }
  }, [overlayVisible, inCall, callType, cameraOff]);

  const startCall = async (type) => {
    if (!socketRef.current || !joinedRoom) {
      alert("Please wait a moment and try again.");
      return;
    }

    if (inCall) return;

    cleanupCall();

    try {
      setCallType(type);
      setRemoteName("Contact");
      isCallerRef.current = true;
      acceptedRef.current = false;
      pendingOfferRef.current = null;
      iceQueueRef.current = [];

      socketRef.current.emit("signal", {
        roomId,
        data: {
          type: "call",
          callType: type,
          from: myName,
        },
      });
    } catch (err) {
      console.error("startCall failed", err);
    }
  };

  const answerCall = async () => {
    try {
      acceptedRef.current = true;

      socketRef.current?.emit("signal", {
        roomId,
        data: {
          type: "accept",
          callType: incoming?.callType || "audio",
        },
      });

      if (pendingOfferRef.current) {
        const offerData = pendingOfferRef.current;
        pendingOfferRef.current = null;
        setIncoming(null);
        await handleOffer(offerData);
      } else {
        setIncoming(null);
      }
    } catch (err) {
      console.error("answerCall failed", err);
    }
  };

  const declineCall = () => {
    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "hangup" },
    });
    setIncoming(null);
    acceptedRef.current = false;
    pendingOfferRef.current = null;
  };

  const hangup = () => {
    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "hangup" },
    });
    cleanupCall();
  };

  const toggleMute = async () => {
    const nextMuted = !userMutedRef.current;
    userMutedRef.current = nextMuted;
    setMuted(nextMuted);

    const stream = localStreamRef.current;
    const audioTracks = stream?.getAudioTracks?.() || [];

    if (nextMuted) {
      audioTracks.forEach((track) => {
        track.enabled = false;
      });
      return;
    }

    if (!audioTracks.length || audioTracks[0].readyState !== "live") {
      await repairMicrophone("manual-unmute", true);
      return;
    }

    audioTracks.forEach((track) => {
      track.enabled = true;
    });

    const sender = findSenderByKind(pcRef.current, "audio");
    if (!sender?.track || sender.track.id !== audioTracks[0].id) {
      await repairMicrophone("manual-unmute-sender", true);
    }
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextCameraOff = !cameraOff;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    setCameraOff(nextCameraOff);
  };

  const switchCamera = async () => {
    if (callType !== "video" || cameraOff) return;

    const currentStream = localStreamRef.current;
    const pc = pcRef.current;
    if (!currentStream || !pc) return;

    const nextFacingMode = facingMode === "user" ? "environment" : "user";

    try {
      const replacementStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode } },
        audio: false,
      });
      const replacementTrack = replacementStream.getVideoTracks()[0];
      if (!replacementTrack) return;

      const sender = pc.getSenders().find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(replacementTrack);

      currentStream.getVideoTracks().forEach((track) => {
        currentStream.removeTrack(track);
        track.stop();
      });
      currentStream.addTrack(replacementTrack);
      localStreamRef.current = currentStream;
      setFacingMode(nextFacingMode);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = currentStream;
        localVideoRef.current.play?.().catch(() => {});
      }
    } catch (err) {
      console.error("switch camera failed", err);
      alert("Could not switch camera. Your device/browser may not expose a second camera.");
    }
  };

  const shareScreen = async () => {
    try {
      if (!pcRef.current) return;

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      screenStreamRef.current = displayStream;

      const screenTrack = displayStream.getVideoTracks()[0];
      const sender = pcRef.current
        .getSenders()
        .find((s) => s.track?.kind === "video");

      if (sender && screenTrack) {
        await sender.replaceTrack(screenTrack);
      }

      screenTrack.onended = async () => {
        const cameraTrack = localStreamRef.current?.getVideoTracks?.()[0];
        if (sender && cameraTrack) {
          await sender.replaceTrack(cameraTrack);
        }
        displayStream.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      };
    } catch (err) {
      console.error("screen share failed", err);
    }
  };

  return (
    <>
      <CallHeader
        room={displayRoomId || roomId}
        onStartAudio={() => startCall("audio")}
        onStartVideo={() => startCall("video")}
        inCall={inCall}
        callType={callType}
        joinedRoom={joinedRoom}
        onExitRoom={onExitRoom}
        onOpenSupport={onOpenSupport}
      />

      <FullScreenCallOverlay
        visible={overlayVisible}
        inCall={inCall}
        incoming={incoming}
        callType={incoming?.callType || callType}
        remoteName={incoming?.from || remoteName}
        connectionMessage={connectionMessage}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        remoteAudioRef={remoteAudioRef}
        onAnswer={answerCall}
        onDecline={declineCall}
        onHangup={hangup}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onSwitchCamera={switchCamera}
        onShareScreen={shareScreen}
        muted={muted}
        cameraOff={cameraOff}
        remoteStream={remoteStream}
        facingMode={facingMode}
      />
    </>
  );
}

const inputClass = "admin-field";

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function deviceType(deviceName = "") {
  const value = String(deviceName).toLowerCase();
  if (/iphone|ipad|ios/.test(value)) return "iOS";
  if (/android/.test(value)) return "Android";
  if (/macintosh|mac os|macbook/.test(value)) return "Mac";
  if (/windows/.test(value)) return "Windows";
  if (/linux/.test(value)) return "Linux";
  return "Other";
}

function StatCard({ label, value, accent, active, onClick, subtitle }) {
  return (
    <button
      type="button"
      className={`admin-stat-card ${active ? "is-active" : ""}`}
      style={{ "--accent": accent }}
      onClick={onClick}
    >
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
      {subtitle ? <span className="admin-stat-subtitle">{subtitle}</span> : null}
    </button>
  );
}

function EmptyState({ children }) {
  return <div className="admin-empty">{children}</div>;
}

function AdminDashboard({ API_BASE, onBack }) {
  const [adminPin, setAdminPin] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState("overview");
  const [search, setSearch] = useState("");

  const [dashboard, setDashboard] = useState({
    totalUsers: 0,
    onlineNow: 0,
    joinedThisWeek: 0,
    countries: 0,
    activeUsers: 0,
    expiredUsers: 0,
    pendingPayments: 0,
    openSupport: 0,
    closedSupport: 0,
    totalRooms: 0,
    totalDevices: 0,
    topCountries: [],
    deviceSummary: [],
  });

  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [payments, setPayments] = useState([]);
  const [support, setSupport] = useState([]);
  const [plans, setPlans] = useState([]);
  const [userDrafts, setUserDrafts] = useState({});
  const [planDrafts, setPlanDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [adminDeleteKey, setAdminDeleteKey] = useState("");

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-admin-pin": adminPin,
    }),
    [adminPin]
  );

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function buildUserDrafts(nextUsers) {
    setUserDrafts(
      nextUsers.reduce((acc, user) => {
        acc[user.id] = {
          username: user.username || "",
          contact: user.contact || "",
          accessKey: user.accessKey || "",
          subscriptionEnd: user.subscriptionEnd || "",
          deviceLimit: user.deviceLimit || 2,
          status: user.status || "active",
          subscriptionStatus: user.subscriptionStatus || "active",
        };
        return acc;
      }, {})
    );
  }

  async function loadAll() {
    if (!adminPin.trim()) {
      alert("Enter admin PIN");
      return;
    }

    setLoading(true);
    try {
      const [dashboardData, usersData, devicesData, roomsData, paymentsData, supportData, plansData] =
        await Promise.all([
          request("/api/admin/dashboard"),
          request("/api/admin/users"),
          request("/api/admin/devices"),
          request("/api/admin/rooms"),
          request("/api/admin/payments"),
          request("/api/admin/support"),
          fetch(`${API_BASE}/api/plans`).then((res) => res.json()),
        ]);

      const nextUsers = Array.isArray(usersData) ? usersData : [];
      const nextPlans = Array.isArray(plansData) ? plansData : [];

      setDashboard(dashboardData);
      setUsers(nextUsers);
      setDevices(Array.isArray(devicesData) ? devicesData : []);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setSupport(Array.isArray(supportData) ? supportData : []);
      setPlans(nextPlans);
      setSelectedUserIds([]);
      setSelectedDeviceIds([]);
      setSelectedRoomIds([]);
      buildUserDrafts(nextUsers);
      setPlanDrafts(
        nextPlans.reduce((acc, plan) => {
          acc[plan.id] = {
            name: plan.name || "",
            price: plan.price ?? 0,
            days: plan.days ?? 30,
            active: plan.active !== false,
          };
          return acc;
        }, {})
      );
      setAuthenticated(true);
    } catch (error) {
      setAuthenticated(false);
      alert(error.message || "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authenticated) return undefined;
    const id = setInterval(() => {
      request("/api/admin/dashboard")
        .then(setDashboard)
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [authenticated, adminPin]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredUsers = users.filter((user) => {
    if (!normalizedSearch) return true;
    return [user.username, user.contact, user.accessKey, user.subscriptionStatus, user.status]
      .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
  });

  const onlineUsers = users.filter((user) => user.isOnline);
  const joinedThisWeekUsers = users.filter((user) => user.joinedThisWeek);
  const expiredUsers = users.filter((user) => user.subscriptionStatus === "expired");
  const activeUsers = users.filter(
    (user) => user.status === "active" && user.subscriptionStatus !== "expired"
  );
  const pendingPayments = payments.filter((payment) => payment.status === "pending");
  const openSupport = support.filter(
    (ticket) => !["closed", "solved", "archived"].includes(ticket.status)
  );
  const closedSupport = support.filter(
    (ticket) => ticket.status === "closed"
  );

  async function saveUser(userId) {
    const draft = userDrafts[userId];
    if (!draft) return;
    try {
      await request(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...draft,
          deviceLimit: Number(draft.deviceLimit) || 2,
        }),
      });
      await loadAll();
      alert("User updated");
    } catch (error) {
      alert(error.message);
    }
  }

  async function extendUser(userId, days) {
    try {
      await request(`/api/admin/users/${userId}/extend`, {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function removeDevice(deviceId) {
    if (!window.confirm("Delete this device permanently? The device will disappear immediately and may log in again if the Access Key still has space.")) return;
    try {
      await request(`/api/admin/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      setDevices((current) => current.filter((device) => device.id !== deviceId));
      setSelectedDeviceIds((current) => current.filter((id) => id !== deviceId));
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  function toggleDeviceSelection(deviceId) {
    setSelectedDeviceIds((current) =>
      current.includes(deviceId)
        ? current.filter((id) => id !== deviceId)
        : [...current, deviceId]
    );
  }

  function toggleAllDevices() {
    const ids = devices.map((device) => device.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedDeviceIds.includes(id));
    setSelectedDeviceIds(allSelected ? [] : ids);
  }

  async function deleteSelectedDevices() {
    if (!selectedDeviceIds.length) {
      alert("Select at least one device");
      return;
    }
    if (!window.confirm(`Delete ${selectedDeviceIds.length} selected device(s) permanently?`)) return;
    try {
      await request("/api/admin/devices/delete-multiple", {
        method: "POST",
        body: JSON.stringify({ deviceIds: selectedDeviceIds }),
      });
      setDevices((current) => current.filter((device) => !selectedDeviceIds.includes(device.id)));
      setSelectedDeviceIds([]);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteAllDevices() {
    if (!devices.length) return;
    if (!adminDeleteKey.trim()) {
      alert("Enter the Admin Delete Key first");
      return;
    }
    if (!window.confirm(`Delete all ${devices.length} devices permanently?`)) return;
    try {
      await request("/api/admin/devices/delete-all", {
        method: "POST",
        headers: { "x-admin-key": adminDeleteKey.trim() },
        body: JSON.stringify({ adminDeleteKey: adminDeleteKey.trim() }),
      });
      setDevices([]);
      setSelectedDeviceIds([]);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteRoom(roomId) {
    if (!window.confirm(`Delete room ${roomId}?`)) return;
    try {
      await request(`/api/admin/rooms/${encodeURIComponent(roomId)}`, {
        method: "DELETE",
      });
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  function toggleRoomSelection(roomId) {
    setSelectedRoomIds((current) =>
      current.includes(roomId)
        ? current.filter((id) => id !== roomId)
        : [...current, roomId]
    );
  }

  function toggleAllRooms() {
    const ids = rooms.map((room) => room.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedRoomIds.includes(id));
    setSelectedRoomIds(allSelected ? [] : ids);
  }

  async function deleteSelectedRooms() {
    if (!selectedRoomIds.length) {
      alert("Select at least one room");
      return;
    }
    if (!window.confirm(`Delete ${selectedRoomIds.length} selected room(s)? Their Stream channels and messages will also be deleted.`)) return;
    try {
      await request("/api/admin/rooms/delete-multiple", {
        method: "POST",
        body: JSON.stringify({ roomIds: selectedRoomIds }),
      });
      setRooms((current) => current.filter((room) => !selectedRoomIds.includes(room.id)));
      setSelectedRoomIds([]);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteAllRooms() {
    if (!rooms.length) return;
    if (!adminDeleteKey.trim()) {
      alert("Enter the Admin Delete Key first");
      return;
    }
    if (!window.confirm(`Delete all ${rooms.length} rooms across every Access Key? Stream channels and messages will also be deleted.`)) return;
    try {
      await request("/api/admin/rooms/delete-all", {
        method: "POST",
        headers: { "x-admin-key": adminDeleteKey.trim() },
        body: JSON.stringify({ adminDeleteKey: adminDeleteKey.trim() }),
      });
      setRooms([]);
      setSelectedRoomIds([]);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  function toggleUserSelection(userId) {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  }

  function toggleAllVisibleUsers() {
    const ids = userListForView.map((user) => user.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedUserIds.includes(id));
    setSelectedUserIds(allSelected ? [] : ids);
  }

  async function deleteSelectedUsers() {
    if (!selectedUserIds.length) {
      alert("Select at least one user");
      return;
    }
    if (!window.confirm(
      `Delete ${selectedUserIds.length} selected user(s)? Their Access Keys, rooms, Stream channels, devices and support records will also be deleted.`
    )) return;
    try {
      await request("/api/admin/users/delete-multiple", {
        method: "POST",
        body: JSON.stringify({ userIds: selectedUserIds }),
      });
      setUsers((current) => current.filter((user) => !selectedUserIds.includes(user.id)));
      setSelectedUserIds([]);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteOneUser(userId, username) {
    if (!window.confirm(`Delete ${username || "this user"}? Their Access Key, devices, rooms, Stream channels and support records will also be deleted.`)) return;
    try {
      await request(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      setUsers((current) => current.filter((user) => user.id !== userId));
      setSelectedUserIds((current) => current.filter((id) => id !== userId));
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteAllUsers() {
    if (!users.length) return;
    if (!adminDeleteKey.trim()) {
      alert("Enter the Admin Delete Key first");
      return;
    }
    if (!window.confirm(`Delete all ${users.length} users? This also deletes all Access Keys, devices, rooms, Stream channels and support records.`)) return;
    try {
      await request("/api/admin/users/delete-all", {
        method: "POST",
        headers: { "x-admin-key": adminDeleteKey.trim() },
        body: JSON.stringify({ adminDeleteKey: adminDeleteKey.trim() }),
      });
      setUsers([]);
      setDevices([]);
      setRooms([]);
      setSelectedUserIds([]);
      setSelectedDeviceIds([]);
      setSelectedRoomIds([]);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function approvePayment(paymentId) {
    if (!window.confirm("Approve payment and generate Access Key?")) return;
    try {
      const result = await request(`/api/admin/payments/${paymentId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      alert(`Approved. Access Key: ${result.accessKey || result.user?.accessKey}`);
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function rejectPayment(paymentId) {
    const reason = window.prompt("Rejection reason", "Payment not verified");
    if (reason === null) return;
    try {
      await request(`/api/admin/payments/${paymentId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function replySupport(requestId) {
    const message = String(replyDrafts[requestId] || "").trim();
    if (!message) {
      alert("Write a reply first");
      return;
    }
    try {
      await request(`/api/admin/support/${requestId}/reply`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setReplyDrafts((current) => ({ ...current, [requestId]: "" }));
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function updateTicketStatus(requestId, status) {
    try {
      await request(`/api/admin/support/${requestId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function savePlan(planId) {
    const draft = planDrafts[planId];
    if (!draft) return;
    try {
      await request(`/api/admin/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          price: Number(draft.price),
          days: Number(draft.days),
          active: Boolean(draft.active),
        }),
      });
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  }

  function openView(view) {
    setActiveView(view);
    window.setTimeout(() => {
      document.getElementById("admin-detail-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }

  const userListForView =
    activeView === "online"
      ? onlineUsers
      : activeView === "joined"
        ? joinedThisWeekUsers
        : activeView === "expired"
          ? expiredUsers
          : activeView === "active"
            ? activeUsers
            : filteredUsers;

  return (
    <div className="admin-page-shell">
      <main className="admin-dashboard">
        <header className="admin-topbar">
          <div>
            <p className="admin-eyebrow">PRIVATE ROOM CONTROL CENTER</p>
            <h1>Admin Dashboard</h1>
            <p>Click any number to open its data and make changes.</p>
          </div>
          <button type="button" className="admin-back-button" onClick={onBack}>
            Back to App
          </button>
        </header>

        <section className="admin-login-panel">
          <input
            type="password"
            value={adminPin}
            onChange={(event) => setAdminPin(event.target.value)}
            placeholder="Admin PIN"
            onKeyDown={(event) => {
              if (event.key === "Enter") loadAll();
            }}
          />
          <button type="button" onClick={loadAll} disabled={loading}>
            {loading ? "Loading..." : authenticated ? "Refresh Data" : "Open Dashboard"}
          </button>
        </section>

        {authenticated ? (
          <>
            <section className="admin-stat-grid">
              <StatCard label="Total users" value={dashboard.totalUsers} accent="#27c3cf" active={activeView === "users"} onClick={() => openView("users")} />
              <StatCard label="Online now" value={dashboard.onlineNow} accent="#36b875" active={activeView === "online"} onClick={() => openView("online")} />
              <StatCard label="Joined this week" value={dashboard.joinedThisWeek} accent="#ff765a" active={activeView === "joined"} onClick={() => openView("joined")} />
              <StatCard label="Countries" value={dashboard.countries} accent="#9468db" active={activeView === "countries"} onClick={() => openView("countries")} />
              <StatCard label="Active users" value={dashboard.activeUsers} accent="#3b82f6" active={activeView === "active"} onClick={() => openView("active")} />
              <StatCard label="Expired users" value={dashboard.expiredUsers} accent="#ef4444" active={activeView === "expired"} onClick={() => openView("expired")} />
              <StatCard label="Rooms" value={dashboard.totalRooms} accent="#f59e0b" active={activeView === "rooms"} onClick={() => openView("rooms")} />
              <StatCard label="Devices" value={dashboard.totalDevices} accent="#14b8a6" active={activeView === "devices"} onClick={() => openView("devices")} />
              <StatCard label="Pending payments" value={dashboard.pendingPayments} accent="#8b5cf6" active={activeView === "payments"} onClick={() => openView("payments")} />
              <StatCard label="Open support" value={dashboard.openSupport} accent="#ec4899" active={activeView === "support"} onClick={() => openView("support")} />
              <StatCard label="Closed tickets" value={dashboard.closedSupport || 0} accent="#64748b" active={activeView === "closed_support"} onClick={() => openView("closed_support")} />
            </section>

            <section className="admin-overview-grid">
              <button className="admin-overview-card" type="button" onClick={() => openView("countries")}>
                <div className="admin-card-heading"><h2>Top countries</h2><span>{dashboard.totalUsers} located</span></div>
                {(dashboard.topCountries || []).length ? dashboard.topCountries.map((item) => (
                  <div className="admin-progress-row" key={item.country}>
                    <strong>{item.country || "Unknown"}</strong>
                    <span className="admin-progress-track"><span style={{ width: `${Math.max(8, item.percentage || 0)}%` }} /></span>
                    <em>{item.count}</em>
                  </div>
                )) : <EmptyState>No country data yet.</EmptyState>}
              </button>

              <button className="admin-overview-card" type="button" onClick={() => openView("devices")}>
                <div className="admin-card-heading"><h2>Devices</h2><span>Latest login</span></div>
                {(dashboard.deviceSummary || []).length ? dashboard.deviceSummary.map((item) => (
                  <div className="admin-progress-row" key={item.type}>
                    <strong>{item.type}</strong>
                    <span className="admin-progress-track"><span style={{ width: `${Math.max(8, item.percentage || 0)}%` }} /></span>
                    <em>{item.count}</em>
                  </div>
                )) : <EmptyState>No device data yet.</EmptyState>}
              </button>
            </section>

            <section id="admin-detail-panel" className="admin-detail-panel">
              <div className="admin-detail-heading">
                <div>
                  <p className="admin-eyebrow">CLICKABLE DATA VIEW</p>
                  <h2>{activeView.replace(/(^|_)(\w)/g, (_, __, letter) => ` ${letter.toUpperCase()}`).trim()}</h2>
                </div>
                {["users", "online", "joined", "active", "expired"].includes(activeView) ? (
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, contact or Access Key" />
                ) : null}
              </div>

              {["users", "online", "joined", "active", "expired", "devices", "rooms"].includes(activeView) && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    marginBottom: 16,
                    padding: 14,
                    borderRadius: 14,
                    background: "#fff7ed",
                    border: "1px solid #fed7aa",
                  }}
                >
                  <input
                    type="password"
                    value={adminDeleteKey}
                    onChange={(event) => setAdminDeleteKey(event.target.value)}
                    placeholder="Admin Delete Key — required only for Delete All"
                    style={{ ...adminInputStyle, marginBottom: 0 }}
                  />
                  <span style={{ alignSelf: "center", color: "#9a3412", fontWeight: 800, fontSize: 12 }}>
                    Permanent actions
                  </span>
                </div>
              )}

              {["overview", "users", "online", "joined", "active", "expired"].includes(activeView) && (
                <div className="admin-record-list">
                  <div className="admin-actions" style={{ marginBottom: 14 }}>
                    <button type="button" className="secondary" onClick={toggleAllVisibleUsers}>
                      {userListForView.length > 0 && userListForView.every((user) => selectedUserIds.includes(user.id)) ? "Clear selection" : "Select all visible"}
                    </button>
                    <button type="button" className="danger-button" disabled={!selectedUserIds.length} onClick={deleteSelectedUsers}>
                      Delete selected users ({selectedUserIds.length})
                    </button>
                    <button type="button" className="danger-button" disabled={!users.length} onClick={deleteAllUsers}>
                      Delete all users ({users.length})
                    </button>
                  </div>
                  {userListForView.length ? userListForView.map((user) => {
                    const draft = userDrafts[user.id] || {};
                    return (
                      <article className="admin-user-card" key={user.id}>
                        <div className="admin-user-card-top">
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 12 }}>
                            <input type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={() => toggleUserSelection(user.id)} />
                            Select
                          </label>
                          <div>
                            <h3>{user.username || "Unnamed user"}</h3>
                            <p>Access Key: <strong>{user.accessKey}</strong></p>
                          </div>
                          <span className={`admin-status ${user.subscriptionStatus === "expired" || user.status === "blocked" ? "danger" : "success"}`}>
                            {user.status === "blocked" ? "Blocked" : user.subscriptionStatus || "active"}
                          </span>
                        </div>

                        <div className="admin-edit-grid">
                          <label>Username<input className={inputClass} value={draft.username || ""} onChange={(e) => setUserDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], username: e.target.value } }))} /></label>
                          <label>Contact<input className={inputClass} value={draft.contact || ""} onChange={(e) => setUserDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], contact: e.target.value } }))} /></label>
                          <label>Access Key<input className={inputClass} value={draft.accessKey || ""} onChange={(e) => setUserDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], accessKey: e.target.value } }))} /></label>
                          <label>Expiry<input className={inputClass} type="date" value={String(draft.subscriptionEnd || "").slice(0, 10)} onChange={(e) => setUserDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], subscriptionEnd: e.target.value } }))} /></label>
                          <label>Device limit<input className={inputClass} type="number" min="1" value={draft.deviceLimit || 2} onChange={(e) => setUserDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], deviceLimit: e.target.value } }))} /></label>
                          <label>Account status<select className={inputClass} value={draft.status || "active"} onChange={(e) => setUserDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], status: e.target.value } }))}><option value="active">Active</option><option value="blocked">Blocked</option></select></label>
                        </div>

                        <div className="admin-meta-grid">
                          <span>Joined: {formatDate(user.createdAt)}</span>
                          <span>Last login: {formatDateTime(user.lastLoginAt)}</span>
                          <span>Country: {user.country || "Unknown"}</span>
                          <span>Devices: {user.devicesUsed || 0}/{user.deviceLimit || 2}</span>
                          <span>Rooms: {user.roomsCount || 0}</span>
                          <span>{user.isOnline ? "Online now" : "Offline"}</span>
                        </div>

                        <div className="admin-actions">
                          <button onClick={() => saveUser(user.id)}>Save changes</button>
                          <button className="secondary" onClick={() => extendUser(user.id, 30)}>+1 month</button>
                          <button className="secondary" onClick={() => extendUser(user.id, 90)}>+3 months</button>
                          <button className="secondary" onClick={() => extendUser(user.id, 365)}>+1 year</button>
                          <button className="danger-button" onClick={() => deleteOneUser(user.id, user.username)}>Delete user</button>
                        </div>
                      </article>
                    );
                  }) : <EmptyState>No matching users.</EmptyState>}
                </div>
              )}

              {activeView === "countries" && (
                <div className="admin-table-wrap"><table><thead><tr><th>Country</th><th>Users</th><th>Percentage</th></tr></thead><tbody>{(dashboard.topCountries || []).map((item) => <tr key={item.country}><td>{item.country || "Unknown"}</td><td>{item.count}</td><td>{item.percentage || 0}%</td></tr>)}</tbody></table></div>
              )}

              {activeView === "devices" && (
                <div>
                  <div className="admin-actions" style={{ marginBottom: 14 }}>
                    <button type="button" className="secondary" onClick={toggleAllDevices}>
                      {devices.length > 0 && devices.every((device) => selectedDeviceIds.includes(device.id)) ? "Clear selection" : "Select all devices"}
                    </button>
                    <button type="button" className="danger-button" disabled={!selectedDeviceIds.length} onClick={deleteSelectedDevices}>
                      Delete selected ({selectedDeviceIds.length})
                    </button>
                    <button type="button" className="danger-button" disabled={!devices.length} onClick={deleteAllDevices}>
                      Delete all devices ({devices.length})
                    </button>
                  </div>
                  <div className="admin-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th><input type="checkbox" checked={devices.length > 0 && devices.every((device) => selectedDeviceIds.includes(device.id))} onChange={toggleAllDevices} /></th>
                          <th>User</th><th>Access Key</th><th>Type</th><th>Device</th><th>Country</th><th>Last login</th><th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map((device) => (
                          <tr key={device.id}>
                            <td><input type="checkbox" checked={selectedDeviceIds.includes(device.id)} onChange={() => toggleDeviceSelection(device.id)} /></td>
                            <td>{device.username || "Unknown"}</td>
                            <td>{device.accessKey}</td>
                            <td>{device.deviceType || deviceType(device.deviceName)}</td>
                            <td>{device.deviceName || "Unknown"}</td>
                            <td>{device.country || "Unknown"}</td>
                            <td>{formatDateTime(device.lastLoginAt)}</td>
                            <td><button className="table-danger" onClick={() => removeDevice(device.id)}>Delete</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeView === "rooms" && (
                <div>
                  <div className="admin-actions" style={{ marginBottom: 14 }}>
                    <button type="button" className="secondary" onClick={toggleAllRooms}>
                      {rooms.length > 0 && rooms.every((room) => selectedRoomIds.includes(room.id)) ? "Clear selection" : "Select all rooms"}
                    </button>
                    <button type="button" className="danger-button" disabled={!selectedRoomIds.length} onClick={deleteSelectedRooms}>
                      Delete selected ({selectedRoomIds.length})
                    </button>
                    <button type="button" className="danger-button" disabled={!rooms.length} onClick={deleteAllRooms}>
                      Delete all rooms ({rooms.length})
                    </button>
                  </div>
                  <div className="admin-table-wrap">
                    <table>
                      <thead><tr><th><input type="checkbox" checked={rooms.length > 0 && rooms.every((room) => selectedRoomIds.includes(room.id))} onChange={toggleAllRooms} /></th><th>Room</th><th>Owner</th><th>Access Key</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
                      <tbody>{rooms.map((room) => <tr key={room.id}><td><input type="checkbox" checked={selectedRoomIds.includes(room.id)} onChange={() => toggleRoomSelection(room.id)} /></td><td>{room.roomName || room.roomId}</td><td>{room.username || room.ownerName || "Unknown"}</td><td>{room.accessKey}</td><td>{room.status || "active"}</td><td>{formatDate(room.createdAt)}</td><td><button className="table-danger" onClick={() => deleteRoom(room.id)}>Delete</button></td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeView === "payments" && (
                <div className="admin-record-list">{pendingPayments.length ? pendingPayments.map((payment) => <article className="admin-user-card" key={payment.id}><div className="admin-user-card-top"><div><h3>{payment.username}</h3><p>{payment.contact}</p></div><span className="admin-status warning">Pending</span></div><div className="admin-meta-grid"><span>Plan: {payment.planName}</span><span>Amount: AED {payment.amount}</span><span>UPI ref: {payment.upiReference}</span><span>Submitted: {formatDateTime(payment.createdAt)}</span></div><div className="admin-actions"><button onClick={() => approvePayment(payment.id)}>Approve & generate key</button><button className="danger-button" onClick={() => rejectPayment(payment.id)}>Reject</button></div></article>) : <EmptyState>No pending payments.</EmptyState>}</div>
              )}

              {["support", "closed_support"].includes(activeView) && (
                <div className="admin-record-list">
                  {(activeView === "closed_support" ? closedSupport : openSupport).length ?
                    (activeView === "closed_support" ? closedSupport : openSupport).map((ticket) => {
                      const isClosed = ["closed", "solved", "archived"].includes(ticket.status);
                      return (
                        <article className="admin-user-card" key={ticket.id}>
                          <div className="admin-user-card-top">
                            <div><h3>{ticket.issueType || "Support"}</h3><p>{ticket.username || ticket.guestName || "Guest"} · {ticket.accessKey || "Public"}</p></div>
                            <select className={inputClass} value={ticket.status || "open"} onChange={(e) => updateTicketStatus(ticket.id, e.target.value)}>
                              <option value="open">Open / Reopen</option>
                              <option value="in_progress">In progress</option>
                              <option value="waiting_for_user">Waiting for user</option>
                              <option value="solved">Solved</option>
                              <option value="closed">Closed</option>
                            </select>
                          </div>
                          <div className="admin-message-thread">{(ticket.messages || []).map((message) => <div className={message.senderType === "admin" ? "admin-message admin" : "admin-message"} key={message.id}><strong>{message.senderType === "admin" ? "Admin" : "User"}</strong><p>{message.message}</p><small>{formatDateTime(message.createdAt)}</small></div>)}</div>
                          {isClosed ? (
                            <div className="admin-empty">This ticket is closed. Reopen it to send a reply.</div>
                          ) : (
                            <>
                              <textarea className={inputClass} rows="3" value={replyDrafts[ticket.id] || ""} onChange={(e) => setReplyDrafts((current) => ({ ...current, [ticket.id]: e.target.value }))} placeholder="Reply to user" />
                              <div className="admin-actions"><button onClick={() => replySupport(ticket.id)}>Send reply</button></div>
                            </>
                          )}
                        </article>
                      );
                    }) : <EmptyState>{activeView === "closed_support" ? "No closed tickets." : "No open support tickets."}</EmptyState>}
                </div>
              )}

              {activeView === "plans" && (
                <div className="admin-record-list">{plans.map((plan) => { const draft = planDrafts[plan.id] || {}; return <article className="admin-user-card" key={plan.id}><h3>{plan.name}</h3><div className="admin-edit-grid"><label>Name<input className={inputClass} value={draft.name || ""} onChange={(e) => setPlanDrafts((current) => ({ ...current, [plan.id]: { ...current[plan.id], name: e.target.value } }))} /></label><label>Price<input className={inputClass} type="number" value={draft.price ?? 0} onChange={(e) => setPlanDrafts((current) => ({ ...current, [plan.id]: { ...current[plan.id], price: e.target.value } }))} /></label><label>Days<input className={inputClass} type="number" value={draft.days ?? 30} onChange={(e) => setPlanDrafts((current) => ({ ...current, [plan.id]: { ...current[plan.id], days: e.target.value } }))} /></label></div><div className="admin-actions"><button onClick={() => savePlan(plan.id)}>Save plan</button></div></article>; })}</div>
              )}
            </section>

            <nav className="admin-quick-nav">
              <button onClick={() => openView("users")}>Users</button>
              <button onClick={() => openView("devices")}>Devices</button>
              <button onClick={() => openView("rooms")}>Rooms</button>
              <button onClick={() => openView("payments")}>Payments</button>
              <button onClick={() => openView("support")}>Open Support</button>
              <button onClick={() => openView("closed_support")}>Closed Tickets</button>
              <button onClick={() => openView("plans")}>Plans</button>
            </nav>
          </>
        ) : (
          <div className="admin-locked-state">
            <div>🔐</div>
            <h2>Enter the Admin PIN</h2>
            <p>The dashboard will load users, devices, rooms, payments and support data.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

useEffect(() => {
  const handleResize = () => {
    setIsMobile(window.innerWidth <= 768);
  };

  window.addEventListener("resize", handleResize);

  return () => {
    window.removeEventListener("resize", handleResize);
  };
}, []);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);

    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  const [client, setClient] = useState(null);
  const [channel, setChannel] = useState(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [joining, setJoining] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [accessKey, setAccessKey] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [loggedUser, setLoggedUser] = useState(null);
  const [plans, setPlans] = useState([]);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMode, setSupportMode] = useState("public");
  const [supportSending, setSupportSending] = useState(false);
  const [supportTickets, setSupportTickets] = useState([]);
const [supportLoading, setSupportLoading] = useState(false);
const [supportReplyText, setSupportReplyText] = useState("");

  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [subscribePlan, setSubscribePlan] = useState(null);
  const [subscribeName, setSubscribeName] = useState("");
  const [subscribeContact, setSubscribeContact] = useState("");
  const [generatedAccessKey, setGeneratedAccessKey] = useState("");
  const [subscribeUpiReference, setSubscribeUpiReference] = useState("");
  const [paymentRequestStatus, setPaymentRequestStatus] = useState(null);
  const [paymentSettings, setPaymentSettings] = useState({
  upiId: "9781723138@sbi",
  upiName: "Private Room Subscription",
});

  const [adminPin, setAdminPin] = useState("");
  const [adminAccessKeySearch, setAdminAccessKeySearch] = useState("");
  const [adminSupportResults, setAdminSupportResults] = useState([]);
  const [adminReplyDrafts, setAdminReplyDrafts] = useState({});
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminRooms, setAdminRooms] = useState([]);
  const [adminPayments, setAdminPayments] = useState([]);
  const [adminPaymentSearch, setAdminPaymentSearch] = useState("");
  const [adminPaymentComments, setAdminPaymentComments] = useState({});
  const [adminRoomsAccessKey, setAdminRoomsAccessKey] = useState("");
  const [adminDeleteKey, setAdminDeleteKey] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);

  const [newUserName, setNewUserName] = useState("");
  const [newUserAccessKey, setNewUserAccessKey] = useState("");
  const [newUserContact, setNewUserContact] = useState("");
  const [newUserEndDate, setNewUserEndDate] = useState("2026-12-31");
  const [newUserDeviceLimit, setNewUserDeviceLimit] = useState(2);

  const [planDrafts, setPlanDrafts] = useState({});
  const [userEditDrafts, setUserEditDrafts] = useState({});
  const [supportForm, setSupportForm] = useState({
    
    name: "",
    contact: "",
    accessKey: "",
    issueType: "I want to buy a subscription",
    message: "",
  });

  const audioRecordingConfig = {};

  useEffect(() => {
  return () => {
    if (client) client.disconnectUser();
  };
}, [client]);

useEffect(() => {
  if (!loggedUser?.accessKey) return undefined;

  const sendActivity = () => {
    const location = getClientLocationInfo();
    fetch(`${API_BASE}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessKey: loggedUser.accessKey,
        deviceId: getDeviceId(),
        ...location,
      }),
    }).catch(() => {});
  };

  sendActivity();
  const id = setInterval(sendActivity, 60000);
  return () => clearInterval(id);
}, [loggedUser]);

useEffect(() => {
  let cancelled = false;

  apiFetch(`${API_BASE}/api/payment-settings`)
    .then((res) => res.json())
    .then((data) => {
      if (!cancelled) {
        setPaymentSettings({
          upiId: data.upiId || "9781723138@sbi",
          upiName: data.upiName || "Private Room Subscription",
        });
      }
    })
    .catch(() => {
      if (!cancelled) {
        setPaymentSettings({
          upiId: "9781723138@sbi",
          upiName: "Private Room Subscription",
        });
      }
    });

  return () => {
    cancelled = true;
  };
}, []);

useEffect(() => {
  let cancelled = false;

  apiFetch(`${API_BASE}/api/plans`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          const nextPlans = Array.isArray(data) ? data : [];
          setPlans(nextPlans);
          setPlanDrafts(
            nextPlans.reduce((acc, plan) => {
              acc[plan.id] = {
                name: plan.name || "",
                price: plan.price ?? 0,
                days: plan.days ?? 30,
              };
              return acc;
            }, {})
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load plans:", err);
        if (!cancelled) setPlans([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const privateRoomId = createPrivateRoomId(accessKey, room);

  useEffect(() => {
    if (!client || !room || !accessKey) return;
    let cancelled = false;

    const init = async () => {
      try {
        const ch = client.channel("messaging", privateRoomId, {
          name: `Room ${room}`,
          accessKey,
          roomCode: room,
        });

        await ch.watch();

        if (!cancelled) {
          setChannel(ch);
        }
      } catch (err) {
        console.error("channel init error", err);
        if (!cancelled) setChannel(null);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [client, room, accessKey, privateRoomId]);

  function updateSupportForm(nextValues) {
    setSupportForm((current) => ({
      ...current,
      ...nextValues,
    }));
  }

  function openPublicSupport(issueType = "I want to buy a subscription") {
  setSupportMode("public");

  setSupportForm({
    name: name || "",
    contact: "",
    accessKey: "",
    issueType,
    message: "",
  });

  setSupportTickets([]);
  setSupportReplyText("");
  setSupportOpen(true);
}

  function openRoomSupport() {
  const key = String(accessKey || "").trim();

  setSupportMode(key ? "room" : "public");

  setSupportForm((current) => ({
    ...current,
    name: name || current.name || "Guest",
    contact: current.contact || "",
    accessKey: key,
    issueType: "Room issue",
    message: "",
  }));

  setSupportOpen(true);

  if (key) {
    loadSupportTickets(key);
  }
}
  async function loadSupportTickets(currentAccessKey = accessKey) {
  const key = String(currentAccessKey || "").trim();

  if (!key) {
    setSupportTickets([]);
    return;
  }

  try {
    setSupportLoading(true);

    const res = await fetch(
      `${API_BASE}/api/support/${encodeURIComponent(key)}`
    );

    const data = await res.json().catch(() => []);

    if (!res.ok) {
      throw new Error(data.error || "Failed to load support messages");
    }

    setSupportTickets(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("loadSupportTickets error", err);
  } finally {
    setSupportLoading(false);
  }
}

async function sendSupportMessage() {
  const key = String(accessKey || supportForm.accessKey || "").trim();
  const message = String(supportForm.message || "").trim();

  if (!key) {
    alert("Please enter your Access Key first.");
    return;
  }

  if (!message) {
    alert("Please type your support message.");
    return;
  }

  try {
    setSupportSending(true);

    const res = await apiFetch(`${API_BASE}/api/support`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessKey: key,
        username: name || supportForm.name || "Guest",
        contact: supportForm.contact || "",
        roomName: room || "",
        roomId: room || "",
        issueType: supportForm.issueType || "Support",
        message,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Failed to send support message");
    }

    setSupportForm((current) => ({
      ...current,
      accessKey: key,
      message: "",
    }));

    await loadSupportTickets(key);
  } catch (err) {
    alert(err.message || "Failed to send support message");
  } finally {
    setSupportSending(false);
  }
}

async function replyToSupportTicket(ticketId) {
  const key = String(accessKey || supportForm.accessKey || "").trim();
  const message = String(supportReplyText || "").trim();

  if (!key) {
    alert("Access Key is required.");
    return;
  }

  if (!message) {
    alert("Please type your reply.");
    return;
  }

  try {
    setSupportSending(true);

    const res = await fetch(
      `${API_BASE}/api/support/${encodeURIComponent(ticketId)}/reply`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessKey: key,
          message,
        }),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Failed to send reply");
    }

    setSupportReplyText("");
    await loadSupportTickets(key);
  } catch (err) {
    alert(err.message || "Failed to send reply");
  } finally {
    setSupportSending(false);
  }
}

  async function submitSupport() {
  if (supportMode === "public") {
    if (!supportForm.message.trim()) {
      alert("Please write your message");
      return;
    }

    try {
      setSupportSending(true);

      const res = await apiFetch(`${API_BASE}/api/support`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
  accessKey: supportForm.accessKey || "PUBLIC",
  username: supportForm.name || "Guest",
  contact: supportForm.contact || "",
  roomName: "",
  roomId: "",
  issueType: supportForm.issueType || "I want to buy a subscription",
  message: supportForm.message,
}),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to send support message");
      }

      alert("Support message sent");
      setSupportOpen(false);
      setSupportForm((current) => ({
        ...current,
        message: "",
      }));
    } catch (err) {
      alert(err.message || "Failed to send support message");
    } finally {
      setSupportSending(false);
    }

    return;
  }

  await sendSupportMessage();
}
async function subscribeAndGenerateAccessKey(e) {
  e?.preventDefault?.();
  if (!subscribeName || !subscribeContact || !subscribePlan || !subscribeUpiReference) {
    alert("Enter username, phone/email, and UPI payment reference number");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/subscribe/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: subscribeName,
        contact: subscribeContact,
        planId: subscribePlan.id,
        upiReference: subscribeUpiReference,
      }),
    });

    const result = await res.json().catch(() => ({}));
    if (result.alreadySubmitted) {
  setPaymentRequestStatus(result);

  if (result.status === "approved" && result.accessKey) {
    alert(`Payment approved. Your Access Key is: ${result.accessKey}`);
  } else if (result.status === "rejected") {
    alert(result.message || "Your payment request was rejected.");
  } else {
    alert("Your payment request is already pending admin approval.");
  }

  return;
}

    if (!res.ok) {
      alert(result.error || "Subscription failed");
      return;
    }

    alert(
      "Payment submitted successfully. Please wait for admin approval. Your 5-digit Access Key will be generated after approval."
    );

    setSubscribeOpen(false);
    setSubscribeName("");
    setSubscribeContact("");
    setSubscribeUpiReference("");
    setGeneratedAccessKey("");
  } catch (err) {
    console.error("subscribe error:", err);
    alert("Subscription failed");
  }
}

async function adminCreateUser() {
  if (!adminPin || !newUserName.trim()) {
    alert("Enter admin PIN and username");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({
        username: newUserName.trim(),
        contact: newUserContact.trim(),
        accessKey: newUserAccessKey.trim() || undefined,
        subscriptionEnd: newUserEndDate,
        deviceLimit: Number(newUserDeviceLimit) || 2,
        status: "active",
        subscriptionStatus: "active",
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to create user");
      return;
    }

    alert(`User created successfully. Access Key: ${data.user?.accessKey || data.accessKey || "created"}`);
    setNewUserName("");
    setNewUserContact("");
    setNewUserAccessKey("");
    adminLoadUsers();
  } catch (err) {
    console.error("Create user error:", err);
    alert("Failed to create user");
  }
}

async function adminLoadUsers() {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  setAdminLoading(true);

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/users`, {
      headers: {
        "x-admin-pin": adminPin,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to load users");
      return;
    }

    const users = Array.isArray(data) ? data : data.users || [];
    setAdminUsers(users);
    setUserEditDrafts(
      users.reduce((acc, user) => {
        acc[user.id] = {
          username: user.username || "",
          contact: user.contact || "",
          accessKey: user.accessKey || "",
          subscriptionEnd: user.subscriptionEnd || user.subscription_end || "",
          deviceLimit: user.deviceLimit || user.device_limit || 2,
          status: user.status || "active",
          subscriptionStatus: user.subscriptionStatus || user.subscription_status || "active",
        };
        return acc;
      }, {})
    );
  } catch (err) {
    console.error("Load users error:", err);
    alert("Failed to load users");
  } finally {
    setAdminLoading(false);
  }
}

async function adminSaveUser(userId) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  const draft = userEditDrafts[userId];

  if (!draft) {
    alert("User details not found");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({
        ...draft,
        deviceLimit: Number(draft.deviceLimit) || 2,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to update user");
      return;
    }

    alert("User updated");
    adminLoadUsers();
  } catch (err) {
    console.error("Save user error:", err);
    alert("Failed to update user");
  }
}

async function adminExtendUser(userId, days = 30) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/extend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({ days }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to extend subscription");
      return;
    }

    alert(`Subscription extended by ${days} days`);
    adminLoadUsers();
  } catch (err) {
    console.error("Extend user error:", err);
    alert("Failed to extend subscription");
  }
}

async function adminLoadRooms() {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  try {
    const query = adminRoomsAccessKey
      ? `?accessKey=${encodeURIComponent(adminRoomsAccessKey)}`
      : "";

    const res = await apiFetch(`${API_BASE}/api/admin/rooms${query}`, {
      headers: {
        "x-admin-pin": adminPin,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to load rooms");
      return;
    }

    setAdminRooms(Array.isArray(data) ? data : data.rooms || []);
  } catch (err) {
    console.error("Load rooms error:", err);
    alert("Failed to load rooms");
  }
}

async function adminDeleteRoom(roomId) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  const ok = window.confirm(`Delete room ${roomId}?`);
  if (!ok) return;

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/rooms/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      headers: {
        "x-admin-pin": adminPin,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to delete room");
      return;
    }

    alert("Room deleted");
    adminLoadRooms();
  } catch (err) {
    console.error("Delete room error:", err);
    alert("Failed to delete room");
  }
}

async function adminDeleteRoomsByAccessKey() {
  if (!adminPin || !adminRoomsAccessKey) {
    alert("Enter admin PIN and Access Key");
    return;
  }

  const ok = window.confirm(`Delete all rooms for Access Key ${adminRoomsAccessKey}?`);
  if (!ok) return;

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/rooms/delete-by-access-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({
        accessKey: adminRoomsAccessKey,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to delete rooms");
      return;
    }

    alert(`Deleted ${data.deleted || 0} room(s)`);
    adminLoadRooms();
  } catch (err) {
    console.error("Delete rooms by key error:", err);
    alert("Failed to delete rooms");
  }
}

async function adminDeleteAllRooms() {
  if (!adminDeleteKey) {
    alert("Enter admin delete key");
    return;
  }

  const ok = window.confirm("ADMIN: Delete all rooms for everyone?");
  if (!ok) return;

  try {
    const res = await apiFetch(`${API_BASE}/api/delete-all-rooms`, {
      method: "POST",
      headers: {
        "x-admin-key": adminDeleteKey,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to delete all rooms");
      return;
    }

    alert(`Deleted ${data.deleted || 0} room(s)`);
    setAdminRooms([]);
  } catch (err) {
    console.error("Admin delete all rooms error:", err);
    alert("Failed to delete all rooms");
  }
}

async function adminSavePlan(planId) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  const draft = planDrafts[planId];

  if (!draft) {
    alert("Plan details not found");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/plans/${planId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({
        name: draft.name,
        price: Number(draft.price),
        days: Number(draft.days),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to update plan");
      return;
    }

    alert("Subscription plan updated");

    const refreshed = await apiFetch(`${API_BASE}/api/plans`).then((r) => r.json());
    setPlans(Array.isArray(refreshed) ? refreshed : []);
  } catch (err) {
    console.error("Save plan error:", err);
    alert("Failed to update plan");
  }
}

async function adminSearchSupport() {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  try {
    const query = adminAccessKeySearch
      ? `?accessKey=${encodeURIComponent(adminAccessKeySearch)}`
      : "";

    const res = await apiFetch(`${API_BASE}/api/admin/support${query}`, {
      headers: {
        "x-admin-pin": adminPin,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to load support");
      return;
    }

    setAdminSupportResults(Array.isArray(data) ? data : data.supportRequests || []);
  } catch (err) {
    console.error("Support search error:", err);
    alert("Failed to search support");
  }
}

async function adminLoadPayments() {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/payments`, {
      headers: {
        "x-admin-pin": adminPin,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to load payments");
      return;
    }

    setAdminPayments(Array.isArray(data) ? data : data.payments || []);
  } catch (err) {
    console.error("Load payments error:", err);
    alert("Failed to load payments");
  }
}

async function adminApprovePayment(paymentId) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  const ok = window.confirm("Approve this payment and generate Access Key?");
  if (!ok) return;

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/payments/${paymentId}/approve`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-pin": adminPin,
  },
  body: JSON.stringify({
    comment: adminPaymentComments[paymentId] || "",
  }),
});

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to approve payment");
      return;
    }

    alert(`Payment approved. Access Key: ${data.accessKey || data.user?.accessKey}`);

setAdminPayments((current) =>
  current.filter((payment) => payment.id !== paymentId)
);

adminLoadPayments();
adminLoadUsers();
  } catch (err) {
    console.error("Approve payment error:", err);
    alert("Failed to approve payment");
  }
}

async function adminRejectPayment(paymentId) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  const reason = window.prompt("Reason for rejection", "Payment not verified");
  if (reason === null) return;

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/payments/${paymentId}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({
        reason,
        comment: adminPaymentComments[paymentId] || reason,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to reject payment");
      return;
    }

    alert("Payment rejected");

setAdminPayments((current) =>
  current.filter((payment) => payment.id !== paymentId)
);

adminLoadPayments();
  } catch (err) {
    console.error("Reject payment error:", err);
    alert("Failed to reject payment");
  }
}
async function adminReplyToSupport(requestId) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  const message = adminReplyDrafts[requestId];

  if (!message || !message.trim()) {
    alert("Write a reply first");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/support/${requestId}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({ message }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to send reply");
      return;
    }

    setAdminReplyDrafts((current) => ({
      ...current,
      [requestId]: "",
    }));

    alert("Reply sent");
    adminSearchSupport();
  } catch (err) {
    console.error("Admin reply error:", err);
    alert("Failed to send reply");
  }
}

async function adminUpdateTicketStatus(requestId, status) {
  if (!adminPin) {
    alert("Enter admin PIN");
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/support/${requestId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({ status }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Failed to update ticket");
      return;
    }

    if (status === "closed" || status === "solved") {
  setAdminSupportResults((current) =>
    current.filter((ticket) => ticket.id !== requestId)
  );
} else {
  adminSearchSupport();
}
  } catch (err) {
    console.error("Ticket status error:", err);
    alert("Failed to update ticket");
  }
}

async function joinRoom() {
  if (!name || !accessKey || !room) {
    alert("Enter your name, Access Key and room number");
    return;
  }

    if (!apiKey) {
      alert("Missing VITE_STREAM_API_KEY in frontend .env");
      return;
    }

    setJoining(true);
    const currentDeviceId = getDeviceId();
    const streamUserId = createStreamUserId(accessKey, name, currentDeviceId);
    const privateRoomIdForLogin = createPrivateRoomId(accessKey, room);

    try {
      const loginRes = await apiFetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: name,
          accessKey,
          participantId: streamUserId,
          roomCode: room,
          privateRoomId: privateRoomIdForLogin,
          deviceId: currentDeviceId,
          deviceName: getDeviceName(),
          ...getClientLocationInfo(),
        }),
      });

      const loginData = await loginRes.json().catch(() => ({}));

      if (!loginRes.ok) {
        alert(loginData.error || "Login failed");
        return;
      }

      setLoggedUser(loginData.user);
      localStorage.setItem("logged_user", JSON.stringify(loginData.user));

      const tokenRes = await apiFetch(`${API_BASE}/api/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    userId: streamUserId,
    name: name || "Guest",
    username: name || "Guest",
    room: privateRoomIdForLogin,
    roomCode: room,
    accessKey,
  }),
});

const tokenData = await tokenRes.json().catch(() => ({}));

if (!tokenRes.ok) {
  throw new Error(tokenData.error || tokenData.details || "Failed to create token");
}

      
      const chatClient = StreamChat.getInstance(apiKey);
      await chatClient.connectUser(
  {
    id: tokenData.userId || streamUserId,
    name: tokenData.name || name || "Guest",
  },
  tokenData.token
);
      setClient(chatClient);
    } catch (err) {
      console.error("joinRoom error", err);
alert(err.message || "Join failed - see console");
    } finally {
      setJoining(false);
    }
  }

  const exitRoom = async () => {
    try {
      if (client) {
        await client.disconnectUser();
      }
    } catch (err) {
      console.error("exitRoom error", err);
    } finally {
      setChannel(null);
      setClient(null);
      setName("");
      setAccessKey("");
      setRoom("");
      setLoggedUser(null);
      setJoining(false);
      setPreviewImage(null);
    }
  };

  async function manageRoomsByAccessKey() {
    const key = String(accessKey || "").trim();

    if (!key) {
      alert("Enter your Access Key first");
      return;
    }

    const ok = window.confirm(
      "Manage Room will delete rooms linked to this Access Key only. Continue?"
    );
    if (!ok) return;

    try {
      const res = await apiFetch(`${API_BASE}/api/rooms/delete-by-access-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accessKey: key }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data.error || "Failed to manage rooms");
        return;
      }

      alert(`Deleted ${data.deleted || 0} room(s) for this Access Key`);
    } catch (err) {
      console.error("Manage room error:", err);
      alert(err.message || "Failed to manage rooms");
    }
  }

  const CustomImage = (props) => {
    const imageUrl =
      props?.image_url ||
      props?.thumb_url ||
      props?.asset_url ||
      props?.og?.image_url ||
      props?.og?.asset_url ||
      props?.og?.thumb_url;

    if (!imageUrl) return null;

    return (
      <img
        src={imageUrl}
        alt="attachment"
        onClick={() => setPreviewImage(imageUrl)}
        style={{
          maxWidth: "100%",
          borderRadius: 12,
          cursor: "pointer",
          display: "block",
        }}
      />
    );
  };

  const CustomAttachment = (props) => {
    return <Attachment {...props} Image={CustomImage} />;
  };

  const MyMessage = (props) => {
    const context = useMessageContext();
    const message = context?.message || props?.message;
    const contextGroupStyles = context?.groupStyles || props?.groupStyles || [];

    if (!message) return null;

    if (message.type === "system") {
      return (
        <div
          style={{
            margin: "12px auto",
            width: "fit-content",
            maxWidth: "90%",
            padding: "6px 13px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(15,23,42,0.06)",
            color: "#64748b",
            fontSize: 12,
            fontWeight: 700,
            textAlign: "center",
            boxShadow: "0 2px 8px rgba(15,23,42,0.05)",
          }}
        >
          {message.text || "System message"}
        </div>
      );
    }

    const isMine = message.user?.id === client?.userID;
    const senderName =
      message.user?.name ||
      message.user?.id ||
      (isMine ? name || "You" : "User");
    const senderInitial =
      String(senderName).trim().slice(0, 1).toUpperCase() || "U";
    const senderImage = message.user?.image;
    const sentAt = message.created_at || message.updated_at;
    const messageCreatedAt = new Date(message.created_at || message.updated_at || 0).getTime();
    const readEntries = Object.entries(channel?.state?.read || {});
    const hasBeenSeen = isMine && readEntries.some(([userId, readState]) => {
      if (!userId || userId === client?.userID) return false;
      const lastRead = new Date(readState?.last_read || 0).getTime();
      return Number.isFinite(lastRead) && lastRead >= messageCreatedAt;
    });

    const rawGroupStyle = Array.isArray(contextGroupStyles)
      ? contextGroupStyles[0]
      : contextGroupStyles;
    const groupStyle = ["top", "middle", "bottom", "single"].includes(
      rawGroupStyle
    )
      ? rawGroupStyle
      : "single";

    const beginsGroup = groupStyle === "top" || groupStyle === "single";
    const endsGroup = groupStyle === "bottom" || groupStyle === "single";
    const isMiddle = groupStyle === "middle";
    const hasAttachments =
      Array.isArray(message.attachments) && message.attachments.length > 0;

    const receivedRadius =
      groupStyle === "single"
        ? "7px 18px 18px 18px"
        : groupStyle === "top"
          ? "7px 18px 18px 7px"
          : groupStyle === "middle"
            ? "7px 18px 18px 7px"
            : "7px 18px 18px 18px";

    const sentRadius =
      groupStyle === "single"
        ? "18px 7px 18px 18px"
        : groupStyle === "top"
          ? "18px 7px 7px 18px"
          : groupStyle === "middle"
            ? "18px 7px 7px 18px"
            : "18px 7px 18px 18px";

    return (
      <div
        style={{
          display: "flex",
          justifyContent: isMine ? "flex-end" : "flex-start",
          width: "100%",
          padding: beginsGroup ? "10px 10px 1px" : "1px 10px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: isMine ? "flex-end" : "flex-start",
            gap: 8,
            width: "fit-content",
            maxWidth: isMobile ? "92%" : "76%",
          }}
        >
          {!isMine && (
            <div
              style={{
                width: 34,
                minWidth: 34,
                height: 34,
                flexShrink: 0,
                visibility: endsGroup ? "visible" : "hidden",
              }}
            >
              {senderImage ? (
                <img
                  src={senderImage}
                  alt={senderName}
                  title={senderName}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    objectFit: "cover",
                    display: "block",
                    boxShadow: "0 4px 12px rgba(5,150,105,0.20)",
                  }}
                />
              ) : (
                <div
                  title={senderName}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                      "linear-gradient(180deg, #10b981 0%, #059669 100%)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 900,
                    boxShadow: "0 4px 12px rgba(5,150,105,0.22)",
                  }}
                >
                  {senderInitial}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              minWidth: 0,
              maxWidth: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: isMine ? "flex-end" : "flex-start",
            }}
          >
            {!isMine && beginsGroup && (
              <div
                style={{
                  margin: "0 0 5px 9px",
                  color: "#07866f",
                  fontSize: 13,
                  lineHeight: 1.2,
                  fontWeight: 900,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {senderName}
              </div>
            )}

            <div
              style={{
                width: "fit-content",
                minWidth: 64,
                maxWidth: "100%",
                position: "relative",
                padding: hasAttachments
                  ? endsGroup
                    ? "7px 7px 20px"
                    : "7px"
                  : endsGroup
                    ? "8px 12px 19px"
                    : "8px 12px",
                borderRadius: isMine ? sentRadius : receivedRadius,
                background: isMine ? "#d9fdd3" : "#ffffff",
                border: "1px solid rgba(15,23,42,0.06)",
                boxShadow: "0 2px 8px rgba(15,23,42,0.10)",
                color: "#111827",
                overflowWrap: "anywhere",
                boxSizing: "border-box",
              }}
            >
              {message.quoted_message && (
                <div
                  style={{
                    marginBottom: 7,
                    padding: "7px 9px",
                    borderLeft: "3px solid #10b981",
                    borderRadius: 8,
                    background: isMine
                      ? "rgba(255,255,255,0.46)"
                      : "#f1f5f9",
                    color: "#475569",
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: 2 }}>
                    {message.quoted_message.user?.name || "Message"}
                  </div>
                  <div>
                    {message.quoted_message.text ||
                      (message.quoted_message.attachments?.length
                        ? "Attachment"
                        : "Message")}
                  </div>
                </div>
              )}

              {message.text && (
                <div
                  style={{
                    fontSize: isMobile ? 14 : 15,
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {message.text}
                </div>
              )}

              {hasAttachments && (
                <div style={{ marginTop: message.text ? 7 : 0 }}>
                  <Attachment attachments={message.attachments} />
                </div>
              )}

              {endsGroup && (
                <div
                  style={{
                    position: "absolute",
                    right: 8,
                    bottom: 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    color: "#667781",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span>{sentAt ? formatTime(sentAt) : ""}</span>
                  {isMine && (
                    <span
                      style={{
                        color: hasBeenSeen ? "#0ea5e9" : "#667781",
                        fontWeight: 900,
                      }}
                    >
                      {hasBeenSeen ? "✓✓" : "✓"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {endsGroup && !isMiddle && (
              <div style={{ height: 2 }} aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    );
  };

  const isAdminPage = window.location.pathname === "/admin";

  if (isAdminPage) {
    return (
      <AdminDashboard
        API_BASE={API_BASE}
        onBack={() => {
          window.location.href = "/";
        }}
      />
    );
  }

  if (!client) {
    const isMobile = viewportWidth < 768;
    const isCompact = viewportWidth < 1100;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          minHeight: "100dvh",
          height: "auto",
          background: `
            radial-gradient(circle at 12% 10%, rgba(125,211,252,0.30), transparent 28%),
            radial-gradient(circle at 88% 12%, rgba(219,234,254,0.75), transparent 28%),
            radial-gradient(circle at 92% 92%, rgba(255,107,74,0.16), transparent 28%),
            linear-gradient(135deg, #f7fdff 0%, #eef8ff 43%, #fffaf7 100%)
          `,
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            position: "relative",
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: isMobile ? "14px" : isCompact ? "24px" : "32px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 1320,
              display: "grid",
              gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : isCompact ? "0.9fr 1.1fr" : "1.05fr 0.95fr",
              gap: isMobile ? 16 : isCompact ? 26 : 44,
              alignItems: "center",
            }}
          >
            <div
              style={{
                color: "#071f2a",
                padding: isMobile ? "8px 2px 0" : isCompact ? "10px 4px" : "16px 8px",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: isMobile ? 12 : isCompact ? 22 : 30,
                  fontWeight: 900,
                  color: "#061821",
                  fontSize: 18,
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#061821",
                    color: "#67e8f9",
                    boxShadow: "0 12px 30px rgba(15,23,42,0.16)",
                  }}
                >
                  💬
                </span>
                Private Room
              </div>

              <div
                style={{
                  textTransform: "uppercase",
                  letterSpacing: 4,
                  color: "#64748b",
                  fontSize: isMobile ? 10 : 13,
                  fontWeight: 900,
                  marginBottom: 18,
                }}
              >
                Private communication, refined
              </div>

              <h1
                style={{
                  margin: 0,
                  fontSize: isMobile ? "clamp(38px, 11vw, 54px)" : isCompact ? "clamp(52px, 6vw, 70px)" : "clamp(66px, 5.5vw, 82px)",
                  lineHeight: 0.96,
                  letterSpacing: isMobile ? -2 : -3,
                  fontWeight: 950,
                  color: "#061821",
                }}
              >
                Less noise.
                <br />
                <span style={{ color: "#ff6b4a" }}>More together.</span>
              </h1>

              <p
                style={{
                  maxWidth: isMobile ? "100%" : 560,
                  margin: isMobile ? "14px 0 16px" : isCompact ? "20px 0 24px" : "24px 0 28px",
                  color: "#475569",
                  fontSize: isMobile ? 14 : isCompact ? 16 : 18,
                  lineHeight: 1.55,
                  fontWeight: 600,
                }}
              >
                Private chat, calls, media sharing, support, and access-key login in one simple room.
              </p>

              {!isMobile && (
                <div
                  style={{
                    width: "min(520px, 100%)",
                    background: "rgba(255,255,255,0.80)",
                    border: "1px solid rgba(15,23,42,0.08)",
                    borderRadius: 24,
                    padding: 20,
                    boxShadow: "0 22px 60px rgba(15,23,42,0.08)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 14,
                      color: "#64748b",
                      fontWeight: 800,
                    }}
                  >
                    <span>
                      <span style={{ color: "#10b981" }}>●</span> Quietly connected
                    </span>
                    <span>now</span>
                  </div>
                  <div
                    style={{
                      height: 9,
                      width: "72%",
                      borderRadius: 99,
                      background: "#dbeafe",
                      marginBottom: 8,
                    }}
                  />
                  <div
                    style={{
                      height: 9,
                      width: "58%",
                      borderRadius: 99,
                      background: "#99f6e4",
                      marginBottom: 8,
                    }}
                  />
                  <div
                    style={{
                      height: 9,
                      width: "68%",
                      borderRadius: 99,
                      background: "#fecaca",
                      marginBottom: 18,
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: "#061821",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 900,
                      }}
                    >
                      M
                    </div>
                    <div>
                      <div style={{ fontWeight: 900, color: "#061821" }}>Morning, team</div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Everything is ready for today.</div>
                    </div>
                    <div style={{ marginLeft: "auto", color: "#94a3b8", fontWeight: 800 }}>09:41</div>
                  </div>
                </div>
              )}

              {!isMobile && (
              <div
                style={{
                  display: "flex",
                  gap: isMobile ? 22 : 38,
                  marginTop: isMobile ? 12 : 22,
                  color: "#061821",
                }}
              >
                <div>
                  <div style={{ fontWeight: 950, fontSize: 22 }}>01</div>
                  <div style={{ color: "#64748b", fontWeight: 700, fontSize: 13 }}>private by default</div>
                </div>
                <div>
                  <div style={{ fontWeight: 950, fontSize: 22 }}>24/7</div>
                  <div style={{ color: "#64748b", fontWeight: 700, fontSize: 13 }}>support access</div>
                </div>
              </div>
              )}
            </div>

            <div
              style={{
                width: "100%",
                maxWidth: isMobile ? "100%" : 500,
                justifySelf: isMobile ? "center" : "end",
                background: "rgba(255,255,255,0.92)",
                border: "1px solid rgba(15,23,42,0.08)",
                borderRadius: isMobile ? 22 : 30,
                padding: isMobile ? 16 : isCompact ? 24 : 28,
                boxShadow: "0 30px 90px rgba(15,23,42,0.16)",
                boxSizing: "border-box",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isMobile ? 16 : 22 }}>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    background: "#061821",
                    color: "#67e8f9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 26,
                    boxShadow: "0 12px 30px rgba(15,23,42,0.16)",
                  }}
                >
                  💬
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 13px",
                    borderRadius: 999,
                    border: "1px solid #e2e8f0",
                    color: "#334155",
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "#10b981" }}>●</span> Private workspace
                </div>
              </div>

              <div
                style={{
                  textTransform: "uppercase",
                  letterSpacing: 3,
                  color: "#64748b",
                  fontSize: 12,
                  fontWeight: 900,
                  marginBottom: 12,
                }}
              >
                Your people, in one place
              </div>

              <h2
                style={{
                  margin: 0,
                  color: "#061821",
                  fontSize: isMobile ? 32 : isCompact ? 38 : 44,
                  lineHeight: 1,
                  letterSpacing: -2,
                  fontWeight: 950,
                }}
              >
                Welcome back.
              </h2>
              <p style={{ margin: isMobile ? "10px 0 16px" : "12px 0 18px", color: "#64748b", lineHeight: 1.5, fontWeight: 600, fontSize: isMobile ? 14 : 15 }}>
                Login with your Access Key or subscribe to get a new one.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 4,
                  padding: 5,
                  borderRadius: 14,
                  background: "#eaf1f6",
                  marginBottom: isMobile ? 16 : 20,
                }}
              >
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  style={{
                    border: "none",
                    borderRadius: 11,
                    padding: "12px 10px",
                    background: authMode === "login" ? "#ffffff" : "transparent",
                    color: authMode === "login" ? "#061821" : "#64748b",
                    fontWeight: 900,
                    cursor: "pointer",
                    boxShadow: authMode === "login" ? "0 8px 18px rgba(15,23,42,0.08)" : "none",
                  }}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  style={{
                    border: "none",
                    borderRadius: 11,
                    padding: "12px 10px",
                    background: authMode === "signup" ? "#ffffff" : "transparent",
                    color: authMode === "signup" ? "#061821" : "#64748b",
                    fontWeight: 900,
                    cursor: "pointer",
                    boxShadow: authMode === "signup" ? "0 8px 18px rgba(15,23,42,0.08)" : "none",
                  }}
                >
                  Sign Up
                </button>
              </div>

              {authMode === "login" ? (
                <>
                  <label style={{ display: "block", color: "#334155", fontWeight: 900, fontSize: 13, marginBottom: 8 }}>
                    Display name
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Any name"
                    style={{ ...supportInputStyle, marginBottom: 14 }}
                  />

                  <label style={{ display: "block", color: "#334155", fontWeight: 900, fontSize: 13, marginBottom: 8 }}>
                    Access Key
                  </label>
                  <input
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    placeholder="Enter Access Key"
                    style={{ ...supportInputStyle, marginBottom: 14 }}
                  />

                  <label style={{ display: "block", color: "#334155", fontWeight: 900, fontSize: 13, marginBottom: 8 }}>
                    Room code
                  </label>
                  <input
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="Enter room code"
                    style={{ ...supportInputStyle, marginBottom: 18 }}
                  />

                  <button
                    onClick={joinRoom}
                    disabled={joining}
                    style={{
                      width: "100%",
                      height: isMobile ? 48 : 52,
                      border: "none",
                      borderRadius: 14,
                      cursor: joining ? "not-allowed" : "pointer",
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 950,
                      background: "#061821",
                      boxShadow: "0 16px 34px rgba(15,23,42,0.20)",
                    }}
                  >
                    {joining ? "Entering..." : "Continue to Private Room →"}
                  </button>

                  <button
                    type="button"
                    onClick={() => openPublicSupport("I want to buy a subscription")}
                    style={{
                      width: "100%",
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      color: "#0f766e",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Need Help? Contact Support
                  </button>

                  <button
                    type="button"
                    onClick={manageRoomsByAccessKey}
                    style={{
                      width: "100%",
                      marginTop: 10,
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid #fee2e2",
                      background: "#fff5f5",
                      color: "#991b1b",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Manage Room
                  </button>
                </>
              ) : (
                <>
                  <div style={{ color: "#334155", fontWeight: 900, marginBottom: 12 }}>
                    Choose your package
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {plans.length > 0 ? (
                      plans.map((plan) => (
                        <div
                          key={plan.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            alignItems: "center",
                            gap: 12,
                            padding: 14,
                            borderRadius: 18,
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div>
                            <div style={{ color: "#061821", fontWeight: 950 }}>{plan.name}</div>
                            <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>
                              {plan.days} days · 2 devices · Support
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#0f766e", fontWeight: 950, marginBottom: 7 }}>AED {plan.price}</div>
                            <button
                              type="button"
                              onClick={() => {
                                setSubscribePlan(plan);
                                setPaymentRequestStatus(null);
                                setSubscribeName(name || "");
                                setSubscribeContact("");
                                setGeneratedAccessKey("");
                                setSubscribeOpen(true);
                              }}
                              style={{
                                border: "none",
                                borderRadius: 999,
                                padding: "8px 12px",
                                background: "#0f766e",
                                color: "#fff",
                                fontWeight: 900,
                                cursor: "pointer",
                              }}
                            >
                              Subscribe
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div
                        style={{
                          padding: 16,
                          borderRadius: 16,
                          background: "#fff7ed",
                          color: "#9a3412",
                          fontWeight: 800,
                        }}
                      >
                        Packages are loading. If they do not appear, check backend /api/plans.
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => openPublicSupport("I want to buy a subscription")}
                    style={{
                      width: "100%",
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      color: "#0f766e",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Ask support before buying
                  </button>
                </>
              )}

              <div style={{ marginTop: 18, color: "#10b981", fontSize: 13, fontWeight: 800 }}>
                ● No tracking. No noisy notifications. Just your private conversations.
              </div>
            </div>
          </div>
        </div>
        {subscribeOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2600,
              background: "rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 430,
                background: "#ffffff",
                borderRadius: 24,
                padding: 20,
                boxShadow: "0 24px 70px rgba(0,0,0,0.32)",
                boxSizing: "border-box",
              }}
            >
              <h2 style={{ margin: "0 0 8px", color: "#17343a" }}>
                Subscribe to {subscribePlan?.name}
              </h2>

              <p style={{ margin: "0 0 16px", color: "#64748b" }}>
                AED {subscribePlan?.price} · {subscribePlan?.days} days · 1 Access Key · 2 devices only
              </p>
              <div
  style={{
    background: "#ecfdf5",
    border: "1px solid #10b981",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    color: "#064e3b",
  }}
>
  <div style={{ fontWeight: 900, marginBottom: 6 }}>
    Pay first using UPI
  </div>

  <div style={{ fontSize: 14, marginBottom: 4 }}>
    <strong>Amount:</strong> AED {subscribePlan?.price}
  </div>

  <div style={{ fontSize: 14, marginBottom: 4 }}>
    <strong>UPI ID:</strong> {paymentSettings.upiId}
  </div>

  <div style={{ fontSize: 14, marginBottom: 8 }}>
    <strong>Name:</strong> {paymentSettings.upiName}
  </div>

  <a
    href={`upi://pay?pa=${encodeURIComponent(paymentSettings.upiId)}&pn=${encodeURIComponent(paymentSettings.upiName)}&am=${encodeURIComponent(subscribePlan?.price || "")}&cu=INR`}
    style={{
      display: "inline-block",
      textDecoration: "none",
      background: "#0f766e",
      color: "#fff",
      fontWeight: 800,
      borderRadius: 999,
      padding: "9px 14px",
      fontSize: 13,
      marginBottom: 8,
    }}
  >
    Pay Now by UPI
  </a>

  <div style={{ fontSize: 12, color: "#64748b" }}>
    After payment, enter the UPI transaction/reference number below and submit for admin approval.
  </div>
</div>

              <input
                value={subscribeName}
                onChange={(e) => setSubscribeName(e.target.value)}
                placeholder="Choose username"
                style={supportInputStyle}
              />

              <input
                value={subscribeContact}
                onChange={(e) => setSubscribeContact(e.target.value)}
                placeholder="Phone or email"
                style={supportInputStyle}
              />
              <input
                value={subscribeUpiReference}
                onChange={(e) => setSubscribeUpiReference(e.target.value)}
                placeholder="Enter UPI transaction/reference number after payment"
                style={supportInputStyle}
              />

              {generatedAccessKey && (
                <div
                  style={{
                    background: "#ecfdf5",
                    border: "1px solid #10b981",
                    borderRadius: 16,
                    padding: 14,
                    marginBottom: 12,
                    color: "#065f46",
                    fontWeight: 800,
                    textAlign: "center",
                  }}
                >
                  <div>Your Access Key</div>
                  <div style={{ fontSize: 28, letterSpacing: 4 }}>
                    {generatedAccessKey}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>
                    This Access Key works on 2 devices only. It has been filled into the login form.
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={subscribeAndGenerateAccessKey}
                style={{
                  width: "100%",
                  height: 46,
                  borderRadius: 999,
                  border: "none",
                  background: "linear-gradient(180deg, #34d399 0%, #059669 100%)",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                Submit Payment for Approval
              </button>

              <button
  type="button"
  onClick={() => setSubscribeOpen(false)}
                style={{
                  width: "100%",
                  height: 46,
                  borderRadius: 999,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#334155",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        <SupportModal
  open={supportOpen}
  mode={supportMode}
  form={supportForm}
  onChange={updateSupportForm}
  onClose={() => setSupportOpen(false)}
  onSubmit={submitSupport}
  sending={supportSending}
  tickets={supportTickets}
  loading={supportLoading}
  replyText={supportReplyText}
  setReplyText={setSupportReplyText}
  onReply={replyToSupportTicket}
/>
      </div>
    );
  }

  if (!channel) {
    return <div style={{ padding: 20 }}>Loading chat...</div>;
  }

  return (
    <div
      className="private-room-chat-page"
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(135deg, #dcebe7 0%, #f4f0ea 100%)",
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
        padding: isMobile ? 0 : 16,
        boxSizing: "border-box",
      }}
    >
      <div
        className="private-room-chat-shell"
        style={{
          width: "100%",
          maxWidth: 1180,
          height: isMobile ? "100dvh" : "calc(100dvh - 32px)",
          margin: "0 auto",
          borderRadius: isMobile ? 0 : 24,
          background: "#efeae2",
          boxShadow: isMobile ? "none" : "0 22px 70px rgba(15, 76, 70, 0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <style>{`
          .str-chat,
          .str-chat__channel,
          .str-chat__container,
          .str-chat__main-panel,
          .str-chat__main-panel-inner,
          .str-chat__message-list,
          .str-chat__list,
          .str-chat__list-scroll,
          .str-chat__window {
            width: 100% !important;
            max-width: none !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
          }

          .str-chat__channel {
            display: flex !important;
            position: relative !important;
          }

          .str-chat__main-panel {
            flex: 1 1 auto !important;
          }

          .str-chat__thread {
            position: absolute !important;
            top: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: min(430px, 100%) !important;
            max-width: 100% !important;
            z-index: 500 !important;
            background: #ffffff !important;
            box-shadow: -12px 0 35px rgba(15, 23, 42, 0.18) !important;
          }

          .str-chat__message-list-scroll {
            padding-inline: 0 !important;
          }

          .str-chat__message-simple,
          .str-chat__message-simple-inner,
          .str-chat__message-text,
          .str-chat__message-text-inner {
            background: transparent !important;
            border: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }

          .str-chat__message-simple__actions,
          .str-chat__message-options {
            opacity: 0;
            transition: opacity 0.15s ease;
          }

          [data-message-id]:hover .str-chat__message-simple__actions,
          [data-message-id]:hover .str-chat__message-options {
            opacity: 1;
          }

          .str-chat__message-input {
            width: 100% !important;
            background: transparent !important;
          }

          @media (max-width: 768px) {
            .str-chat__thread {
              width: 100% !important;
            }
          }
        `}</style>

        <Chat client={client} theme="messaging light">
          <Channel channel={channel} Attachment={CustomAttachment} Message={MyMessage}>
            <Window>
              <div
                style={{
                  height: "100%",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  background: "#efeae2",
                }}
              >
                <WebRTCCall
                  roomId={privateRoomId}
                  displayRoomId={room}
                  myName={name}
                  onExitRoom={exitRoom}
                  onOpenSupport={openRoomSupport}
                />

                <div
                  className="private-room-message-area"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    padding: isMobile ? "12px 0 8px" : "18px 18px 12px",
                    backgroundColor: "#f7faf9",
                    backgroundImage: `
                      radial-gradient(rgba(16,185,129,0.045) 1px, transparent 1px),
                      radial-gradient(rgba(15,23,42,0.018) 1px, transparent 1px)
                    `,
                    backgroundSize: "18px 18px, 32px 32px",
                    backgroundPosition: "0 0, 8px 8px",
                  }}
                >
                  <MessageList />
                </div>

                <div
                  style={{
                    flexShrink: 0,
                    background: "transparent",
                    padding: "0 14px 4px",
                  }}
                >
                  <TypingIndicator />
                </div>

                <div
                  className="private-room-message-composer"
                  style={{
                    flexShrink: 0,
                    padding: "6px 10px calc(6px + env(safe-area-inset-bottom))",
                    background: "rgba(248,250,252,0.96)",
                    backdropFilter: "blur(10px)",
                    borderTop: "1px solid rgba(0,0,0,0.05)",
                    position: "sticky",
                    bottom: 0,
                    zIndex: 90,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "#fff",
                      borderRadius: 999,
                      padding: "10px 12px",
                      boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                    }}
                  >
                    <Paperclip size={18} color="#667781" />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MessageInput
                        focus
                        grow
                        audioRecordingEnabled
                        asyncMessagesMultiSendEnabled
                        audioRecordingConfig={audioRecordingConfig}
                        additionalTextareaProps={{
                          placeholder: "Type a message",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Window>

            <Thread />
          </Channel>
        </Chat>

        <SupportModal
  open={supportOpen}
  mode={supportMode}
  form={supportForm}
  onChange={updateSupportForm}
  onClose={() => setSupportOpen(false)}
  onSubmit={submitSupport}
  sending={supportSending}
  tickets={supportTickets}
  loading={supportLoading}
  replyText={supportReplyText}
  setReplyText={setSupportReplyText}
  onReply={replyToSupportTicket}
/>

        {previewImage && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.92)",
              zIndex: 2000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              boxSizing: "border-box",
            }}
          >
            <button
              onClick={() => setPreviewImage(null)}
              style={{
                position: "absolute",
                top: 18,
                left: 18,
                border: "none",
                borderRadius: 999,
                padding: "10px 16px",
                background: "rgba(255,255,255,0.16)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ← Back to chat
            </button>

            <img
              src={previewImage}
              alt="preview"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: 12,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}