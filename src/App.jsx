import { useEffect, useRef, useState } from "react";
import { StreamChat } from "stream-chat";
import {
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
  Bug,
} from "lucide-react";
import { io } from "socket.io-client";

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

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

function iconButtonStyle(background) {
  return {
    width: 46,
    height: 46,
    borderRadius: 999,
    border: "none",
    background,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
  };
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
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 14px",
        background: "#075E54",
        color: "#fff",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        position: "fixed",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 1100,
        zIndex: 100,
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Room {room}</div>
        <div style={{ fontSize: 12, opacity: 0.9 }}>
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
            gap: 4,
          }}
        >
          <button
            onClick={onStartAudio}
            title="Audio call"
            style={{
              ...iconButtonStyle("#25D366"),
              opacity: joinedRoom ? 1 : 0.5,
              cursor: joinedRoom ? "pointer" : "not-allowed",
            }}
            disabled={!joinedRoom}
          >
            <Phone size={22} color="#fff" />
          </button>
          <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>
            Call
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          <button
            onClick={onStartVideo}
            title="Video call"
            style={{
              ...iconButtonStyle("#34B7F1"),
              opacity: joinedRoom ? 1 : 0.5,
              cursor: joinedRoom ? "pointer" : "not-allowed",
            }}
            disabled={!joinedRoom}
          >
            <Video size={22} color="#fff" />
          </button>
          <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>
            Video
          </span>
        </div>
      </div>
    </div>
  );
}

function CallDebugPanel({ debugInfo }) {
  const boxStyle = {
    background: "rgba(0,0,0,0.72)",
    color: "#fff",
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.5,
    width: 280,
    maxWidth: "90vw",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  };

  const titleStyle = {
    fontWeight: 700,
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
  };

  const sectionStyle = {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid rgba(255,255,255,0.12)",
  };

  const renderTracks = (tracks, emptyText) => {
    if (!tracks.length) return <div>{emptyText}</div>;

    return tracks.map((track, index) => (
      <div key={index} style={{ marginBottom: 6 }}>
        <div>readyState: {track.readyState}</div>
        <div>enabled: {String(track.enabled)}</div>
        <div>muted: {String(track.muted)}</div>
        <div style={{ opacity: 0.75 }}>{track.label || "No label"}</div>
      </div>
    ));
  };

  return (
    <div style={boxStyle}>
      <div style={titleStyle}>
        <Bug size={14} />
        Call Diagnostics
      </div>

      <div>PC: {debugInfo.pcConnectionState}</div>
      <div>ICE: {debugInfo.iceConnectionState}</div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 700 }}>Local audio</div>
        {renderTracks(debugInfo.localAudio, "No local audio track")}
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 700 }}>Local video</div>
        {renderTracks(debugInfo.localVideo, "No local video track")}
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 700 }}>Remote audio</div>
        {renderTracks(debugInfo.remoteAudio, "No remote audio track")}
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 700 }}>Remote video</div>
        {renderTracks(debugInfo.remoteVideo, "No remote video track")}
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

function WebRTCCall({ roomId, myName }) {
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

  const [debugInfo, setDebugInfo] = useState({
    pcConnectionState: "new",
    iceConnectionState: "new",
    localAudio: [],
    localVideo: [],
    remoteAudio: [],
    remoteVideo: [],
  });

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const refreshDebugInfo = () => {
    const pc = pcRef.current;
    const localStream = localStreamRef.current;
    const remoteStream = remoteStreamRef.current;

    setDebugInfo({
      pcConnectionState: pc?.connectionState || "none",
      iceConnectionState: pc?.iceConnectionState || "none",
      localAudio:
        localStream?.getAudioTracks().map((t) => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
        })) || [],
      localVideo:
        localStream?.getVideoTracks().map((t) => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
        })) || [],
      remoteAudio:
        remoteStream?.getAudioTracks().map((t) => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
        })) || [],
      remoteVideo:
        remoteStream?.getVideoTracks().map((t) => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
        })) || [],
    });
  };

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

    setDebugInfo({
      pcConnectionState: "new",
      iceConnectionState: "new",
      localAudio: [],
      localVideo: [],
      remoteAudio: [],
      remoteVideo: [],
    });
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

      console.log(
        "Remote tracks:",
        stream.getTracks().map((t) => ({
          kind: t.kind,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
        }))
      );

      refreshDebugInfo();
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      socketRef.current?.emit("signal", {
        roomId,
        data: { type: "ice", candidate: event.candidate },
      });
    };

    pc.onconnectionstatechange = () => {
      console.log("pc connection state:", pc.connectionState);
      refreshDebugInfo();

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
          console.log("Call stayed disconnected too long, ending call");
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
      console.log("ice connection state:", pc.iceConnectionState);
      refreshDebugInfo();

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

    console.log(
      "Local tracks:",
      stream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
        label: t.label,
      }))
    );

    stream.getTracks().forEach((track) => {
      const alreadyAdded = pc
        .getSenders()
        .some((sender) => sender.track?.id === track.id);

      if (!alreadyAdded) {
        pc.addTrack(track, stream);
      }
    });

    console.log(
      "Senders:",
      pc.getSenders().map((s) => ({
        kind: s.track?.kind,
        enabled: s.track?.enabled,
        muted: s.track?.muted,
        readyState: s.track?.readyState,
        label: s.track?.label,
      }))
    );

    if (type === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
      localVideoRef.current.autoplay = true;
      localVideoRef.current.play?.().catch(() => {});
    } else if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    refreshDebugInfo();
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
    refreshDebugInfo();
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

    refreshDebugInfo();
  };

  useEffect(() => {
    const s = io("https://myroom-ms7g.onrender.com", {
      transports: ["polling", "websocket"],
      reconnection: true,
    });

    socketRef.current = s;

    const joinCurrentRoom = () => {
      if (!roomId) return;

      s.emit("join-room", { roomId }, (res) => {
        if (res?.ok) {
          console.log("joined room", roomId);
          setJoinedRoom(true);
        } else {
          setJoinedRoom(false);
        }
      });
    };

    s.on("connect", () => {
      console.log("socket connected", s.id);
      setJoinedRoom(false);
      joinCurrentRoom();
    });

    s.on("disconnect", (reason) => {
      console.log("socket disconnected", reason);
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
          refreshDebugInfo();
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
          refreshDebugInfo();
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
      console.log("Attaching remote stream", {
        callType,
        overlayVisible,
        hasRemoteVideoEl: !!remoteVideoRef.current,
        hasRemoteAudioEl: !!remoteAudioRef.current,
        trackKinds: remoteStream.getTracks().map((t) => t.kind),
      });

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

      refreshDebugInfo();
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

    refreshDebugInfo();
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
    refreshDebugInfo();
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextCameraOff = !cameraOff;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    setCameraOff(nextCameraOff);
    refreshDebugInfo();
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
        refreshDebugInfo();
      };

      refreshDebugInfo();
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
      />

      <div style={{ height: 68, flexShrink: 0 }} />

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

  const audioRecordingConfig = {};

  const loginInputStyle = {
    width: "100%",
    padding: "16px 18px",
    borderRadius: 16,
    border: "1px solid #d7dbe0",
    outline: "none",
    fontSize: 16,
    background: "#fff",
    color: "#374151",
    boxSizing: "border-box",
  };

  useEffect(() => {
    return () => {
      if (client) client.disconnectUser();
    };
  }, [client]);

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

  async function joinRoom() {
    if (!name || !room) {
      alert("Enter your name and room number");
      return;
    }

    if (!apiKey) {
      alert("Missing VITE_STREAM_API_KEY in frontend .env");
      return;
    }

    setJoining(true);
    const userId = name.trim().toLowerCase().replace(/\s+/g, "_");

    try {
      const res = await fetch("https://myroom-ms7g.onrender.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name, room }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("token request failed", res.status, text);
        alert("Token fetch failed: " + text);
        return;
      }

      const data = await res.json();

      if (!data.token) {
        console.error("no token returned", data);
        alert("Token error - check console");
        return;
      }

      const chatClient = StreamChat.getInstance(apiKey);
      await chatClient.connectUser({ id: userId, name }, data.token);
      setClient(chatClient);
    } catch (err) {
      console.error("joinRoom error", err);
      alert("Join failed - see console");
    } finally {
      setJoining(false);
    }
  }

  async function deleteAllRooms() {
    const ok = window.confirm("Delete all rooms?");
    if (!ok) return;

    const adminKey = window.prompt("Enter admin key");
    if (!adminKey) return;

    const res = await fetch(
      "https://myroom-ms7g.onrender.com/api/delete-all-rooms",
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
          padding: "2px 12px",
        }}
      >
        <div
          style={{
            maxWidth: "78%",
            background: isMine ? "#DCF8C6" : "#fff",
            borderRadius: 14,
            padding: "6px 10px 18px 10px",
            boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
            position: "relative",
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
                Join securely to chat, share media,
                <br />
                and connect instantly.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                <button
                  onClick={deleteAllRooms}
                  style={{
                    position: "relative",
                    background: "rgba(255,255,255,0.90)",
                    border: "none",
                    padding: "0 14px",
                    color: "#35535a",
                    fontSize: isMobile ? 12.5 : 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    borderRadius: 999,
                  }}
                >
                  Manage Rooms
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
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
        background: "#D9DBD5",
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
    background: "#EFEAE2",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
  }}
>
        <Chat client={client} theme="messaging light">
  <Channel channel={channel}>
    <Window>
      <div
        style={{
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#EFEAE2",
        }}
      >
        <WebRTCCall roomId={room} myName={name} />

        <div
          style={{
            height: 68,
            flexShrink: 0,
          }}
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            paddingBottom: 8,
          }}
        >
          <MessageList Message={MyMessage} />
        </div>

        <div
          style={{
            flexShrink: 0,
            background: "#EFEAE2",
            padding: "0 14px 4px",
          }}
        >
          <TypingIndicator />
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "8px 10px calc(10px + env(safe-area-inset-bottom))",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            background: "#F0F2F5",
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
              padding: "8px 12px",
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
      </div>
    </div>
  );
}