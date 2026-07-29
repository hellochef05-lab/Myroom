import { useEffect, useRef, useState } from "react";
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
} from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";

import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  PhoneOff,
  Video,
} from "lucide-react";
import { io } from "socket.io-client";

const apiKey = import.meta.env.VITE_STREAM_API_KEY;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

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
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        background:
          "linear-gradient(135deg, #0b6158 0%, #0f766e 50%, #115e59 100%)",
        color: "#fff",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "fixed",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 1100,
        zIndex: 100,
        boxSizing: "border-box",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 0.2 }}>
          Room {room}
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
          {inCall
            ? callType === "video"
              ? "Video call in progress"
              : "Audio call in progress"
            : joinedRoom
              ? "Online"
              : "Connecting..."}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <button
            onClick={onStartAudio}
            title="Audio call"
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(180deg, #34d399 0%, #16a34a 100%)",
              cursor: joinedRoom ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 20px rgba(0,0,0,0.20)",
              opacity: joinedRoom ? 1 : 0.5,
            }}
            disabled={!joinedRoom}
          >
            <Phone size={20} color="#fff" />
          </button>
          <span style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>
            Call
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <button
            onClick={onStartVideo}
            title="Video call"
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(180deg, #38bdf8 0%, #2563eb 100%)",
              cursor: joinedRoom ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 20px rgba(0,0,0,0.20)",
              opacity: joinedRoom ? 1 : 0.5,
            }}
            disabled={!joinedRoom}
          >
            <Video size={20} color="#fff" />
          </button>
          <span style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>
            Video
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <button
            onClick={onExitRoom}
            title="Exit room"
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(180deg, #f87171 0%, #dc2626 100%)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 20px rgba(0,0,0,0.20)",
            }}
          >
            <PhoneOff size={20} color="#fff" />
          </button>
          <span style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>
            Exit
          </span>
        </div>
      </div>
    </div>
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
  onShareScreen,
  muted,
  cameraOff,
  remoteStream,
}) {
  if (!visible) return null;

  const isVideo = callType === "video";

  return (
    <div
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
                onClick={onShareScreen}
                style={roundActionButton("rgba(255,255,255,0.18)")}
                title="Share screen"
              >
                <span style={{ color: "#fff", fontSize: 18 }}>📺</span>
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

function WebRTCCall({ roomId, myName, onExitRoom }) {
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

  const [joinedRoom, setJoinedRoom] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteName, setRemoteName] = useState("Contact");
  const [connectionMessage, setConnectionMessage] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const cleanupCall = () => {
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }

    setConnectionMessage("");
    setInCall(false);
    setIncoming(null);
    setCallType(null);
    setMuted(false);
    setCameraOff(false);
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
        ? { audio: true, video: true }
        : { audio: true, video: false };

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

    stream.getTracks().forEach((track) => {
      const alreadyAdded = pc
        .getSenders()
        .some((sender) => sender.track?.id === track.id);

      if (!alreadyAdded) {
        pc.addTrack(track, stream);
      }
    });

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

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextMuted = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
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
        room={roomId}
        onStartAudio={() => startCall("audio")}
        onStartVideo={() => startCall("video")}
        inCall={inCall}
        callType={callType}
        joinedRoom={joinedRoom}
        onExitRoom={onExitRoom}
      />

      <div style={{ height: 62, flexShrink: 0 }} />

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
        onShareScreen={shareScreen}
        muted={muted}
        cameraOff={cameraOff}
        remoteStream={remoteStream}
      />
    </>
  );
}

export default function App() {
  const [client, setClient] = useState(null);
  const [channel, setChannel] = useState(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [joining, setJoining] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [accessKey, setAccessKey] = useState("");
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
  const [adminReplyText, setAdminReplyText] = useState({});
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
  let cancelled = false;

  fetch(`${API_BASE}/api/payment-settings`)
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

  fetch(`${API_BASE}/api/plans`)
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

  useEffect(() => {
    if (!client || !room) return;
    let cancelled = false;

    const init = async () => {
      try {
        const ch = client.channel("messaging", room, {
          name: `Room ${room}`,
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
  }, [client, room]);

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

    const res = await fetch(`${API_BASE}/api/support`, {
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

      const res = await fetch(`${API_BASE}/api/support`, {
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
    const res = await fetch(`${API_BASE}/api/subscribe/request`, {
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
    const res = await fetch(`${API_BASE}/api/admin/users`, {
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
    const res = await fetch(`${API_BASE}/api/admin/users`, {
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
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
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
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/extend`, {
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

    const res = await fetch(`${API_BASE}/api/admin/rooms${query}`, {
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
    const res = await fetch(`${API_BASE}/api/admin/rooms/${encodeURIComponent(roomId)}`, {
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
    const res = await fetch(`${API_BASE}/api/admin/rooms/delete-by-access-key`, {
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
    const res = await fetch(`${API_BASE}/api/delete-all-rooms`, {
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
    const res = await fetch(`${API_BASE}/api/admin/plans/${planId}`, {
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

    const refreshed = await fetch(`${API_BASE}/api/plans`).then((r) => r.json());
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

    const res = await fetch(`${API_BASE}/api/admin/support${query}`, {
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
    const res = await fetch(`${API_BASE}/api/admin/payments`, {
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
    const res = await fetch(`${API_BASE}/api/admin/payments/${paymentId}/approve`, {
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
    const res = await fetch(`${API_BASE}/api/admin/payments/${paymentId}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": adminPin,
      },
      body: JSON.stringify({
        reason,
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
    const res = await fetch(`${API_BASE}/api/admin/support/${requestId}/reply`, {
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
    const res = await fetch(`${API_BASE}/api/admin/support/${requestId}/status`, {
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
    const userId = name.trim().toLowerCase().replace(/\s+/g, "_");

    try {
      const loginRes = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: name,
          accessKey,
          deviceId: getDeviceId(),
          deviceName: getDeviceName(),
        }),
      });

      const loginData = await loginRes.json().catch(() => ({}));

      if (!loginRes.ok) {
        alert(loginData.error || "Login failed");
        return;
      }

      setLoggedUser(loginData.user);
      localStorage.setItem("logged_user", JSON.stringify(loginData.user));

      const tokenRes = await fetch(`${API_BASE}/api/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    userId: loginData.userId || loginData.user?.id || accessKey,
    name: name || username || "Guest",
    username: name || username || "Guest",
    room,
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
    id: tokenData.userId,
    name: tokenData.name || name || username || "Guest",
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

  async function deleteAllRooms() {
    const ok = window.confirm("Delete all rooms?");
    if (!ok) return;

    const adminKey = window.prompt("Enter admin key");
    if (!adminKey) return;

    const res = await fetch(
      `${API_BASE}/api/delete-all-rooms`,
      {
        method: "POST",
        headers: {
          "x-admin-key": adminKey,
        },
      }
    );

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Failed");
      return;
    }

    alert(`Deleted ${data.deleted} rooms`);
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
    const message = props?.message;

    if (!message || !message.type || message.type === "system") {
      return <MessageSimple {...props} />;
    }

    const isMine = message?.user?.id === client?.userID;
    const readCount = message?.read_by?.length || 0;
    const sentAt = message?.created_at || message?.updated_at;

    return (
      <div
        style={{
          display: "flex",
          justifyContent: isMine ? "flex-end" : "flex-start",
          padding: "3px 12px",
        }}
      >
        <div
          style={{
            maxWidth: "78%",
            background: isMine
              ? "linear-gradient(180deg, #dcfce7 0%, #d1fae5 100%)"
              : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
            borderRadius: isMine ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
            padding: "8px 10px 18px 10px",
            boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
            position: "relative",
            border: "1px solid rgba(0,0,0,0.04)",
          }}
        >
          <MessageSimple {...props} />

          <div
            style={{
              position: "absolute",
              right: 10,
              bottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "#667781",
            }}
          >
            <span>{sentAt ? formatTime(sentAt) : ""}</span>
            {isMine && <span>{readCount > 1 ? "✓✓" : "✓"}</span>}
          </div>
        </div>
      </div>
    );
  };


  const isAdminPage = window.location.pathname === "/admin";

  if (isAdminPage) {
    const visibleAdminPayments = adminPayments.filter((payment) => {
  const search = adminPaymentSearch.trim().toLowerCase();

  const isPending = payment.status === "pending";

  const matchesSearch =
    !search ||
    String(payment.username || "").toLowerCase().includes(search) ||
    String(payment.contact || "").toLowerCase().includes(search) ||
    String(payment.upiReference || "").toLowerCase().includes(search) ||
    String(payment.planName || "").toLowerCase().includes(search);

  return isPending && matchesSearch;
});
    const totalUsers = adminUsers.length;
    const activeUsers = adminUsers.filter((user) => user.status === "active").length;
    const expiredUsers = adminUsers.filter(
      (user) =>
        user.subscriptionStatus === "expired" ||
        (user.subscriptionEnd && new Date(user.subscriptionEnd) < new Date())
    ).length;

    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "linear-gradient(135deg, #062c2a 0%, #0f766e 100%)",
          padding: 24,
          boxSizing: "border-box",
          color: "#123c3a",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            background: "#ffffff",
            borderRadius: 24,
            padding: 24,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              marginBottom: 20,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
              <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                Manage users, 5-digit Access Keys, subscriptions, rooms, support, and devices.
              </p>
            </div>

            <button
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "10px 16px",
                background: "#0f766e",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Back to App
            </button>
          </div>

          <div style={{ ...adminCardStyle, marginBottom: 18 }}>
            <h2 style={{ marginTop: 0 }}>Admin Access</h2>
            <input
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value)}
              placeholder="Admin PIN"
              type="password"
              style={adminInputStyle}
            />
            <button
              onClick={() => {
  adminLoadUsers();
  adminLoadRooms();
  adminSearchSupport();
  adminLoadPayments();
}}
              style={{ ...adminButtonStyle, background: "#0f766e" }}
            >
              Load Admin Data
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            {[
              ["Total users", totalUsers],
              ["Active users", activeUsers],
              ["Expired users", expiredUsers],
              ["Rooms loaded", adminRooms.length],
              ["Support tickets", adminSupportResults.length],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div style={{ color: "#64748b", fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#0f766e" }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 18,
            }}
          >
            <div style={{ ...adminCardStyle, gridColumn: "1 / -1" }}>
  <h2 style={{ marginTop: 0 }}>Pending Payment / Access Key Requests</h2>

  <p style={{ color: "#64748b" }}>
    Users who paid by UPI and submitted reference number will appear here.
    Approving payment will generate a 5-digit Access Key with 2-device limit.
  </p>
  <input
  value={adminPaymentSearch}
  onChange={(e) => setAdminPaymentSearch(e.target.value)}
  placeholder="Search by name, mobile number, email, or UPI reference"
  style={{
    ...adminInputStyle,
    maxWidth: 520,
  }}
/>

  <button
    onClick={adminLoadPayments}
    style={{
      ...adminButtonStyle,
      background: "#0f766e",
      maxWidth: 220,
      marginBottom: 12,
    }}
  >
    Load Pending Payments
  </button>

  {visibleAdminPayments.length === 0 ? (
  <p style={{ color: "#64748b" }}>
    No pending payment requests found.
  </p>
) : (
  visibleAdminPayments.map((payment) => (
      <div
        key={payment.id}
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
          }}
        >
          <p><strong>User:</strong> {payment.username}</p>
          <p><strong>Contact:</strong> {payment.contact}</p>
          <p><strong>Plan:</strong> {payment.planName}</p>
          <p>
  <strong>Package Used:</strong> {payment.planName || payment.planId || "N/A"}
</p>

<p>
  <strong>Package Duration:</strong> {payment.days || "N/A"} days
</p>
<p>
  <strong>Package Used:</strong>{" "}
  {payment.planName || payment.planId || "N/A"}
</p>

<p>
  <strong>Package Duration:</strong> {payment.days || "N/A"} days
</p>

<p>
  <strong>Package Amount:</strong> AED {payment.amount || payment.price || "N/A"}
</p>
          <p><strong>Amount:</strong> AED {payment.amount}</p>
          <p><strong>UPI ID:</strong> {payment.upiId}</p>
          <p><strong>UPI Ref:</strong> {payment.upiReference}</p>
          <p><strong>Status:</strong> {payment.status}</p>
          <p><strong>Access Key:</strong> {payment.accessKey || "Not generated yet"}</p>
          <p>
  <strong>Request Date:</strong>{" "}
  {payment.createdAt ? new Date(payment.createdAt).toLocaleDateString() : "N/A"}
</p>

<p>
  <strong>Subscription Days:</strong> {payment.days || "N/A"}
</p>

<p>
  <strong>Expiry After Approval:</strong>{" "}
  {payment.days
    ? new Date(Date.now() + Number(payment.days) * 24 * 60 * 60 * 1000).toLocaleDateString()
    : "N/A"}
</p>

<p>
  <strong>Admin Comment:</strong> {payment.adminComment || "No comment yet"}
</p>

<textarea
  value={adminPaymentComments[payment.id] || payment.adminComment || ""}
  onChange={(e) =>
    setAdminPaymentComments((current) => ({
      ...current,
      [payment.id]: e.target.value,
    }))
  }
  placeholder="Admin payment comment / verification note"
  rows={3}
  style={{
    width: "100%",
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
  }}
/>
        </div>

        {payment.status === "pending" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button
              onClick={() => adminApprovePayment(payment.id)}
              style={{
                ...adminButtonStyle,
                background: "#0f766e",
                width: 180,
              }}
            >
              Approve & Generate Key
            </button>

            <button
              onClick={() => adminRejectPayment(payment.id)}
              style={{
                ...adminButtonStyle,
                background: "#dc2626",
                width: 140,
              }}
            >
              Reject
            </button>
          </div>
        )}
      </div>
    ))
  )}
</div>
            <div style={adminCardStyle}>
              <h2 style={{ marginTop: 0 }}>Subscription Rates</h2>
              <p style={{ color: "#64748b" }}>
                Edit plan price and days shown on the first page.
              </p>

              {plans.map((plan) => (
                <div
                  key={plan.id}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <input
                    value={planDrafts[plan.id]?.name ?? plan.name}
                    onChange={(e) =>
                      setPlanDrafts((current) => ({
                        ...current,
                        [plan.id]: {
                          ...(current[plan.id] || plan),
                          name: e.target.value,
                        },
                      }))
                    }
                    placeholder="Plan name"
                    style={adminInputStyle}
                  />

                  <input
                    value={planDrafts[plan.id]?.price ?? plan.price}
                    onChange={(e) =>
                      setPlanDrafts((current) => ({
                        ...current,
                        [plan.id]: {
                          ...(current[plan.id] || plan),
                          price: e.target.value,
                        },
                      }))
                    }
                    placeholder="Price"
                    type="number"
                    style={adminInputStyle}
                  />

                  <input
                    value={planDrafts[plan.id]?.days ?? plan.days}
                    onChange={(e) =>
                      setPlanDrafts((current) => ({
                        ...current,
                        [plan.id]: {
                          ...(current[plan.id] || plan),
                          days: e.target.value,
                        },
                      }))
                    }
                    placeholder="Days"
                    type="number"
                    style={adminInputStyle}
                  />

                  <button
                    onClick={() => adminSavePlan(plan.id)}
                    style={{ ...adminButtonStyle, background: "#2563eb" }}
                  >
                    Save Plan
                  </button>
                </div>
              ))}
            </div>

            <div style={adminCardStyle}>
              <h2 style={{ marginTop: 0 }}>Create User / Access Key</h2>
              <p style={{ color: "#64748b" }}>
                Access Key is 5 digits. Leave Access Key empty to let the system generate it.
                Default device limit is 2.
              </p>

              <input
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Username"
                style={adminInputStyle}
              />

              <input
                value={newUserContact}
                onChange={(e) => setNewUserContact(e.target.value)}
                placeholder="Phone or email"
                style={adminInputStyle}
              />

              <input
                value={newUserAccessKey}
                onChange={(e) => setNewUserAccessKey(e.target.value)}
                placeholder="Access Key, optional"
                maxLength={5}
                style={adminInputStyle}
              />

              <input
                value={newUserEndDate}
                onChange={(e) => setNewUserEndDate(e.target.value)}
                placeholder="Subscription end date"
                style={adminInputStyle}
              />

              <input
                value={newUserDeviceLimit}
                onChange={(e) => setNewUserDeviceLimit(e.target.value)}
                placeholder="Device limit"
                type="number"
                style={adminInputStyle}
              />

              <button
                onClick={adminCreateUser}
                style={{ ...adminButtonStyle, background: "#0f766e" }}
              >
                Create User
              </button>
            </div>

            <div style={{ ...adminCardStyle, gridColumn: "1 / -1" }}>
              <h2 style={{ marginTop: 0 }}>All Users</h2>
              <p style={{ color: "#64748b" }}>
                Admin can see Access Keys, update device limit, block users, and extend subscriptions.
                Each Access Key works on 2 devices by default.
              </p>

              <button
                onClick={adminLoadUsers}
                style={{
                  ...adminButtonStyle,
                  background: "#0f766e",
                  maxWidth: 220,
                  marginBottom: 12,
                }}
              >
                {adminLoading ? "Loading..." : "Load Users"}
              </button>

              {adminUsers.map((user) => {
                const draft = userEditDrafts[user.id] || {};
                return (
                  <div
                    key={user.id}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                        gap: 10,
                      }}
                    >
                      <input
                        value={draft.username || ""}
                        onChange={(e) =>
                          setUserEditDrafts((current) => ({
                            ...current,
                            [user.id]: { ...(current[user.id] || {}), username: e.target.value },
                          }))
                        }
                        placeholder="Username"
                        style={adminInputStyle}
                      />

                      <input
                        value={draft.contact || ""}
                        onChange={(e) =>
                          setUserEditDrafts((current) => ({
                            ...current,
                            [user.id]: { ...(current[user.id] || {}), contact: e.target.value },
                          }))
                        }
                        placeholder="Contact"
                        style={adminInputStyle}
                      />

                      <input
                        value={draft.accessKey || ""}
                        onChange={(e) =>
                          setUserEditDrafts((current) => ({
                            ...current,
                            [user.id]: { ...(current[user.id] || {}), accessKey: e.target.value },
                          }))
                        }
                        placeholder="Access Key"
                        maxLength={5}
                        style={adminInputStyle}
                      />

                      <input
                        value={draft.subscriptionEnd || ""}
                        onChange={(e) =>
                          setUserEditDrafts((current) => ({
                            ...current,
                            [user.id]: {
                              ...(current[user.id] || {}),
                              subscriptionEnd: e.target.value,
                            },
                          }))
                        }
                        placeholder="Subscription end"
                        style={adminInputStyle}
                      />

                      <input
                        value={draft.deviceLimit || 2}
                        onChange={(e) =>
                          setUserEditDrafts((current) => ({
                            ...current,
                            [user.id]: {
                              ...(current[user.id] || {}),
                              deviceLimit: e.target.value,
                            },
                          }))
                        }
                        placeholder="Device limit"
                        type="number"
                        style={adminInputStyle}
                      />

                      <select
                        value={draft.status || "active"}
                        onChange={(e) =>
                          setUserEditDrafts((current) => ({
                            ...current,
                            [user.id]: { ...(current[user.id] || {}), status: e.target.value },
                          }))
                        }
                        style={adminInputStyle}
                      >
                        <option value="active">Active</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </div>
                    <div
  style={{
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    marginTop: 10,
    padding: 10,
    background: "#f8fafc",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  }}
>
  <p>
    <strong>Package Used:</strong>{" "}
    {user.planName || user.planId || "N/A"}
  </p>

  <p>
    <strong>Subscription Start:</strong>{" "}
    {user.subscriptionStart
      ? new Date(user.subscriptionStart).toLocaleDateString()
      : "N/A"}
  </p>

  <p>
    <strong>Subscription Expiry:</strong>{" "}
    {user.subscriptionEnd
      ? new Date(user.subscriptionEnd).toLocaleDateString()
      : "N/A"}
  </p>

  <p>
    <strong>Joining Date:</strong>{" "}
    {user.joiningDate || user.createdAt
      ? new Date(user.joiningDate || user.createdAt).toLocaleDateString()
      : "N/A"}
  </p>

  <p>
    <strong>Paid Amount:</strong>{" "}
    {user.paidAmount ? `AED ${user.paidAmount}` : "N/A"}
  </p>
</div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        onClick={() => adminSaveUser(user.id)}
                        style={{ ...adminButtonStyle, background: "#2563eb", width: 160 }}
                      >
                        Save User
                      </button>

                      <button
                        onClick={() => adminExtendUser(user.id, 30)}
                        style={{ ...adminButtonStyle, background: "#0f766e", width: 180 }}
                      >
                        Extend 30 Days
                      </button>

                      <button
                        onClick={() => {
                          setAdminRoomsAccessKey(draft.accessKey || user.accessKey || "");
                          setAdminAccessKeySearch(draft.accessKey || user.accessKey || "");
                        }}
                        style={{ ...adminButtonStyle, background: "#475569", width: 190 }}
                      >
                        Use Access Key
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={adminCardStyle}>
              <h2 style={{ marginTop: 0 }}>Rooms by Access Key</h2>
              <input
                value={adminRoomsAccessKey}
                onChange={(e) => setAdminRoomsAccessKey(e.target.value)}
                placeholder="Access Key, leave empty for all rooms"
                style={adminInputStyle}
              />

              <button
                onClick={adminLoadRooms}
                style={{ ...adminButtonStyle, background: "#2563eb", marginBottom: 10 }}
              >
                Load Rooms
              </button>

              <button
                onClick={adminDeleteRoomsByAccessKey}
                style={{ ...adminButtonStyle, background: "#991b1b", marginBottom: 10 }}
              >
                Delete Rooms for This Access Key
              </button>

              <input
                value={adminDeleteKey}
                onChange={(e) => setAdminDeleteKey(e.target.value)}
                placeholder="Admin delete key"
                type="password"
                style={adminInputStyle}
              />

              <button
                onClick={adminDeleteAllRooms}
                style={{ ...adminButtonStyle, background: "#7f1d1d" }}
              >
                Admin Delete All Rooms
              </button>

              <div style={{ marginTop: 12 }}>
                {adminRooms.map((item) => (
                  <div
                    key={item.id || item.roomId}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <strong>Room {item.roomId || item.roomName}</strong>
                    <p style={{ margin: "6px 0" }}>Access Key: {item.accessKey || "N/A"}</p>
                    <p style={{ margin: "6px 0" }}>Owner: {item.ownerName || item.username || "N/A"}</p>
                    <p style={{ margin: "6px 0" }}>Status: {item.status || item.roomStatus || "active"}</p>
                    <button
                      onClick={() => adminDeleteRoom(item.roomId)}
                      style={{ ...adminButtonStyle, background: "#dc2626" }}
                    >
                      Delete Room
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={adminCardStyle}>
              <h2 style={{ marginTop: 0 }}>Support Messages</h2>
              <p style={{ color: "#64748b" }}>
                Leave Access Key empty to see all tickets.
              </p>

              <input
                value={adminAccessKeySearch}
                onChange={(e) => setAdminAccessKeySearch(e.target.value)}
                placeholder="Access Key filter, optional"
                style={adminInputStyle}
              />

              <button
                onClick={adminSearchSupport}
                style={{ ...adminButtonStyle, background: "#2563eb", marginBottom: 12 }}
              >
                Search Support
              </button>

              {adminSupportResults
  .filter((item) => {
    const isSearchingByAccessKey = adminAccessKeySearch.trim().length > 0;

    if (isSearchingByAccessKey) {
      return true;
    }

    return item.status !== "closed" && item.status !== "solved";
  })
  .map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <p style={{ margin: "6px 0", fontWeight: 900 }}>
  <strong>Subject:</strong> {item.issueType || "Support Request"}
</p>
                  <p style={{ margin: "6px 0" }}>
                    <strong>User:</strong> {item.username || item.guestName || "Guest"}
                  </p>
                  
  <p style={{ margin: "6px 0" }}>
  <strong>Contact:</strong> {item.contact || item.phone || item.email || "N/A"}
</p>
                  <p style={{ margin: "6px 0" }}>
                    <strong>Access Key:</strong> {item.accessKey || "N/A"}
                  </p>
                  <p style={{ margin: "6px 0" }}>
                    <strong>Room:</strong> {item.roomName || item.roomId || "N/A"}
                  </p>
                  <p style={{ margin: "6px 0" }}>
                    <strong>Status:</strong> {item.status || "open"}
                  </p>

                  <select
                    value={item.status || "open"}
                    onChange={(e) => adminUpdateTicketStatus(item.id, e.target.value)}
                    style={adminInputStyle}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="waiting_for_user">Waiting for user</option>
                    <option value="solved">Solved</option>
                    <option value="closed">Closed</option>
                  </select>

                  <div
                    style={{
                      marginTop: 10,
                      padding: 10,
                      background: "#f8fafc",
                      borderRadius: 10,
                    }}
                  >
                    {(item.messages || []).map((msg) => (
                      <p key={msg.id} style={{ margin: "8px 0" }}>
                        <strong>{msg.senderType || "user"}:</strong> {msg.message}
                      </p>
                    ))}
                  </div>

                  {item.status !== "closed" &&
item.status !== "solved" &&
item.status !== "archived" ? (
  <>
    <textarea
      value={adminReplyDrafts[item.id] || ""}
      onChange={(e) =>
        setAdminReplyDrafts((current) => ({
          ...current,
          [item.id]: e.target.value,
        }))
      }
      placeholder="Write admin reply"
      style={{
        width: "100%",
        marginTop: 10,
        padding: 10,
        borderRadius: 10,
        border: "1px solid #d1d5db",
        boxSizing: "border-box",
      }}
    />

    <button
      onClick={() => adminReplyToSupport(item.id)}
      style={{
        ...adminButtonStyle,
        width: "100%",
        marginTop: 10,
        background: "#0f766e",
      }}
    >
      Reply to User
    </button>
  </>
) : (
  <div
    style={{
      marginTop: 10,
      padding: 10,
      borderRadius: 10,
      background: "#f1f5f9",
      color: "#64748b",
      fontWeight: 700,
      textAlign: "center",
    }}
  >
    This ticket is closed. Reply disabled.
  </div>
)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!client) {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100dvh",
          background: `
            radial-gradient(circle at 20% 20%, rgba(120,255,220,0.18), transparent 22%),
            radial-gradient(circle at 80% 30%, rgba(120,255,220,0.12), transparent 20%),
            radial-gradient(circle at 50% 85%, rgba(120,255,220,0.10), transparent 24%),
            linear-gradient(135deg, #062c2a 0%, #0b5d57 38%, #117a72 65%, #0b4c47 100%)
          `,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: isMobile ? "18px" : "24px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isMobile ? 340 : 430,
              position: "relative",
            }}
          >
            <div
              style={{
                textAlign: "center",
                marginBottom: isMobile ? 10 : 16,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: isMobile ? "7px 14px" : "8px 18px",
                  borderRadius: 999,
                  color: "#e7fffb",
                  fontSize: isMobile ? 12 : 14,
                  fontWeight: 700,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
                  backdropFilter: "blur(10px)",
                }}
              >
                🔒 Secure Access
              </span>
            </div>

            <div
              style={{
                position: "relative",
                borderRadius: isMobile ? 26 : 34,
                padding: isMobile ? "50px 14px 14px" : "70px 20px 20px",
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.22)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                boxShadow:
                  "0 22px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.25)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: isMobile ? -30 : -42,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: isMobile ? 74 : 96,
                  height: isMobile ? 74 : 96,
                  borderRadius: "50%",
                  background: `
                    radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(255,255,255,0.2) 38%, rgba(0,0,0,0.08) 100%),
                    linear-gradient(180deg, rgba(130,255,225,0.50), rgba(20,120,110,0.30))
                  `,
                  border: "1px solid rgba(255,255,255,0.35)",
                  boxShadow:
                    "0 10px 34px rgba(0,0,0,0.24), inset 0 2px 12px rgba(255,255,255,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isMobile ? 26 : 34,
                }}
              >
                💬
              </div>

              <div
                style={{
                  background: "rgba(255,255,255,0.82)",
                  borderRadius: isMobile ? 20 : 28,
                  padding: isMobile ? "18px 14px 14px" : "28px 22px 20px",
                  border: "1px solid rgba(255,255,255,0.58)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.85), 0 10px 24px rgba(0,0,0,0.14)",
                }}
              >
                <h1
                  style={{
                    margin: 0,
                    textAlign: "center",
                    fontSize: isMobile ? 22 : 28,
                    fontWeight: 800,
                    color: "#17343a",
                    lineHeight: 1.1,
                  }}
                >
                  Private Room
                </h1>

                <p
                  style={{
                    margin: isMobile ? "10px 0 16px" : "12px 0 22px",
                    textAlign: "center",
                    fontSize: isMobile ? 12.5 : 14,
                    lineHeight: 1.45,
                    color: "#56666b",
                  }}
                >
                  Join with your Access Key to chat,
                  <br />
                  share media and connect instantly.
                </p>


                {plans.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr",
                      gap: 8,
                      marginBottom: 14,
                    }}
                  >
                    {plans.map((plan) => (
                      <div
                        key={plan.id}
                        style={{
                          background: "rgba(255,255,255,0.78)",
                          border: "1px solid rgba(16,72,68,0.10)",
                          borderRadius: 16,
                          padding: "10px 12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              color: "#17343a",
                              fontWeight: 800,
                              fontSize: isMobile ? 13 : 14,
                            }}
                          >
                            {plan.name}
                          </div>
                          <div style={{ color: "#64748b", fontSize: 12 }}>
                            {plan.days} days · Default 2 devices · Support
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              color: "#0f766e",
                              fontWeight: 900,
                              fontSize: isMobile ? 14 : 16,
                              whiteSpace: "nowrap",
                            }}
                          >
                            AED {plan.price}
                          </div>

                          <button
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
                              padding: "7px 11px",
                              background: "#0f766e",
                              color: "#fff",
                              fontWeight: 800,
                              fontSize: 12,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Subscribe
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div style={{ position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: isMobile ? 15 : 18,
                        opacity: 0.8,
                      }}
                    >
                      👤
                    </span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      style={{
                        width: "100%",
                        height: isMobile ? 44 : 50,
                        borderRadius: 999,
                        border: "1px solid rgba(16,72,68,0.10)",
                        background: "#f8fbfb",
                        padding: "0 18px 0 42px",
                        fontSize: isMobile ? 14 : 15,
                        outline: "none",
                        boxSizing: "border-box",
                        color: "#1f2937",
                        boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
                      }}
                    />
                  </div>

                  <div style={{ position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: isMobile ? 15 : 18,
                        opacity: 0.8,
                      }}
                    >
                      🛡️
                    </span>
                    <input
                      value={accessKey}
                      onChange={(e) => setAccessKey(e.target.value)}
                      placeholder="Enter Access Key"
                      style={{
                        width: "100%",
                        height: isMobile ? 44 : 50,
                        borderRadius: 999,
                        border: "1px solid rgba(16,72,68,0.10)",
                        background: "#f8fbfb",
                        padding: "0 18px 0 42px",
                        fontSize: isMobile ? 14 : 15,
                        outline: "none",
                        boxSizing: "border-box",
                        color: "#1f2937",
                        boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
                      }}
                    />
                  </div>

                  <div style={{ position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: isMobile ? 15 : 18,
                        opacity: 0.8,
                      }}
                    >
                      🔑
                    </span>
                    <input
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      placeholder="Enter room code"
                      style={{
                        width: "100%",
                        height: isMobile ? 44 : 50,
                        borderRadius: 999,
                        border: "1px solid rgba(16,72,68,0.10)",
                        background: "#f8fbfb",
                        padding: "0 18px 0 42px",
                        fontSize: isMobile ? 14 : 15,
                        outline: "none",
                        boxSizing: "border-box",
                        color: "#1f2937",
                        boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
                      }}
                    />
                  </div>
                </div>

                <button
                  onClick={joinRoom}
                  disabled={joining}
                  style={{
                    width: "100%",
                    marginTop: 14,
                    height: isMobile ? 46 : 52,
                    border: "none",
                    borderRadius: 999,
                    cursor: joining ? "not-allowed" : "pointer",
                    color: "#fff",
                    fontSize: isMobile ? 14.5 : 16,
                    fontWeight: 800,
                    letterSpacing: 0.2,
                    background:
                      "linear-gradient(180deg, #7dffb1 0%, #27c16e 40%, #0a7e43 100%)",
                    boxShadow:
                      "0 8px 20px rgba(18,102,58,0.35), inset 0 2px 8px rgba(255,255,255,0.35), inset 0 -2px 6px rgba(0,0,0,0.18)",
                  }}
                >
                  {joining ? "Entering..." : "Enter Room ›"}
                </button>

              <button
  type="button"
  onClick={() => openPublicSupport("I want to buy a subscription")}
  style={{
    width: "100%",
    marginTop: 10,
    padding: 12,
    borderRadius: 999,
    border: "none",
    background: "#f8fafc",
    color: "#0f766e",
    fontWeight: 800,
    cursor: "pointer",
  }}
>
  Need Help? Contact Support
</button>


                <div
                  style={{
                    marginTop: 12,
                    textAlign: "center",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      height: 1,
                      background: "rgba(24,52,59,0.14)",
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "50%",
                    }}
                  />
                  
                </div>
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
      style={{
        minHeight: "100dvh",
        background: "#dfe5e1",
        display: "flex",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          height: "100dvh",
          background: "#efeae2",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Chat client={client} theme="messaging light">
          <Channel channel={channel} Attachment={CustomAttachment}>
            <Window>
              <div
                style={{
                  height: "100dvh",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  background: "#efeae2",
                }}
              >
                <WebRTCCall
                  roomId={room}
                  myName={name}
                  onExitRoom={exitRoom}
                />

                <div style={{ height: 62, flexShrink: 0 }} />

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    padding: "10px 0 8px",
                    backgroundColor: "#ece5dd",
                    backgroundImage: `
                      radial-gradient(rgba(255,255,255,0.28) 1px, transparent 1px),
                      radial-gradient(rgba(0,0,0,0.02) 1px, transparent 1px)
                    `,
                    backgroundSize: "18px 18px, 32px 32px",
                    backgroundPosition: "0 0, 8px 8px",
                  }}
                >
                  <MessageList Message={MyMessage} />
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
                  style={{
                    flexShrink: 0,
                    padding: "6px 10px calc(6px + env(safe-area-inset-bottom))",
                    background: "rgba(240,242,245,0.94)",
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

        <button
          onClick={openRoomSupport}
          style={{
            position: "absolute",
            right: 18,
            bottom: 86,
            zIndex: 120,
            border: "none",
            borderRadius: 999,
            padding: "12px 16px",
            background: "linear-gradient(180deg, #34d399 0%, #059669 100%)",
            color: "#fff",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 10px 28px rgba(0,0,0,0.20)",
          }}
        >
          Support
        </button>

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