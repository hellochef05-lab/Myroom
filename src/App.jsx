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

function randomId() {
  return "user_" + Math.random().toString(16).slice(2);
}

function formatTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function CallHeader({
  room,
  onStartAudio,
  onStartVideo,
  inCall,
  callType,
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
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Room {room}</div>
        <div style={{ fontSize: 12, opacity: 0.9 }}>
          {inCall
            ? callType === "video"
              ? "Video call in progress"
              : "Audio call in progress"
            : "Online"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onStartAudio}
          title="Audio call"
          style={iconButtonStyle("#ffffff")}
        >
          <Phone size={18} color="#075E54" />
        </button>

        <button
          onClick={onStartVideo}
          title="Video call"
          style={iconButtonStyle("#ffffff")}
        >
          <Video size={18} color="#075E54" />
        </button>
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
      <audio ref={remoteAudioRef} autoPlay playsInline muted />

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
          <div style={{ fontSize: 22, fontWeight: 700 }}>{remoteName || "Contact"}</div>
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
            bottom: 40,
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
            style={roundActionButton(muted ? "#455A64" : "rgba(255,255,255,0.18)")}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff size={20} color="#fff" /> : <Mic size={20} color="#fff" />}
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

function iconButtonStyle(background) {
  return {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "none",
    background,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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

function WebRTCCall({ roomId, myName }) {
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const iceQueueRef = useRef([]);
  const acceptedRef = useRef(false);
  const isCallerRef = useRef(false);

  const [remoteStream, setRemoteStream] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteName, setRemoteName] = useState("Contact");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    const s = io("https://myroom-ms7g.onrender.com", {
      transports: ["polling", "websocket"],
      reconnection: true,
    });

    socketRef.current = s;

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = socketRef.current;
    if (!s || !roomId) return;

    s.emit("join-room", { roomId });

    return () => {
      s.emit("leave-room", { roomId });
    };
  }, [roomId]);

  const cleanupCall = () => {
    setInCall(false);
    setIncoming(null);
    setCallType(null);
    setMuted(false);
    setCameraOff(false);
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
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (remoteStream) {
      remoteStream.getTracks().forEach((t) => t.stop());
      setRemoteStream(null);
    }

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
      let stream = event.streams?.[0];
      if (!stream) {
        stream = remoteStream || new MediaStream();
        if (!stream.getTracks().some((t) => t.id === event.track.id)) {
          stream.addTrack(event.track);
        }
      }
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
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed"
      ) {
        cleanupCall();
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const startLocalMedia = async (type) => {
    if (!pcRef.current) createPC();

    const constraints =
      type === "video"
        ? { audio: true, video: true }
        : { audio: true, video: false };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;

    stream.getTracks().forEach((track) => {
      const alreadyAdded = pcRef.current
        .getSenders()
        .some((sender) => sender.track?.id === track.id);

      if (!alreadyAdded) {
        pcRef.current.addTrack(track, stream);
      }
    });

    if (type === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.play?.().catch(() => {});
    } else if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    return stream;
  };

  const handleOffer = async (data) => {
    if (!pcRef.current) createPC();
    const pc = pcRef.current;

    const nextCallType = data.callType || "audio";
    setCallType(nextCallType);
    setRemoteName(data.from || "Contact");

    await startLocalMedia(nextCallType);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    for (const candidate of iceQueueRef.current) {
      await pc.addIceCandidate(candidate);
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
    if (!pcRef.current) createPC();
    const pc = pcRef.current;

    await startLocalMedia(type);

    const offer = await pc.createOffer();
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
    const s = socketRef.current;
    if (!s) return;

    const onSignal = async (data) => {
      try {
        if (data.type === "call") {
          cleanupCall();
          setIncoming({
            callType: data.callType,
            from: data.from || "Contact",
          });
          setRemoteName(data.from || "Contact");
          setCallType(data.callType || "audio");
          return;
        }

        if (data.type === "accept") {
          if (isCallerRef.current && !pcRef.current) {
            await startOfferFlow(data.callType || callType || "audio");
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
  }, [callType, roomId, myName, remoteStream]);

  useEffect(() => {
    if (!remoteStream) return;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  const startCall = async (type) => {
    if (!socketRef.current || inCall || pcRef.current) return;

    setCallType(type);
    setRemoteName("Contact");
    isCallerRef.current = true;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(() => {});
    }

    socketRef.current.emit("signal", {
      roomId,
      data: {
        type: "call",
        callType: type,
        from: myName,
      },
    });
  };

  const answerCall = async () => {
    acceptedRef.current = true;
    setIncoming(null);

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
      await handleOffer(offerData);
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

  const overlayVisible = Boolean(incoming || inCall || callType);

  return (
    <>
      <CallHeader
        room={roomId}
        onStartAudio={() => startCall("audio")}
        onStartVideo={() => startCall("video")}
        inCall={inCall}
        callType={callType}
      />

      <FullScreenCallOverlay
        visible={overlayVisible}
        inCall={inCall}
        incoming={incoming}
        callType={incoming?.callType || callType}
        remoteName={incoming?.from || remoteName}
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

        const memberCount = Object.keys(ch.state.members || {}).length;
        if (memberCount > 2) {
          alert("Room already has two participants");
          return;
        }

        if (!cancelled) setChannel(ch);
      } catch (err) {
        console.error(err);
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
    const userId = randomId();

    try {
      const res = await fetch("https://myroom-ms7g.onrender.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name }),
      });

      if (!res.ok) {
        console.error("token request failed", res.status, await res.text());
        alert("Token fetch failed");
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

const MyMessage = (props) => {
  const message = props?.message;

  if (!message) return null;

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
          padding: "2px 2px 18px 2px",
          boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
          position: "relative",
        }}
      >
        <MessageSimple {...props} />

        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 6,
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
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#ECE5DD",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#fff",
            borderRadius: 18,
            padding: 24,
            boxShadow: "0 18px 45px rgba(0,0,0,0.12)",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 20 }}>Private Chat Room</h2>

          <label style={{ fontSize: 13, fontWeight: 600 }}>Your Name</label>
          <input
            style={loginInputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="User"
          />

          <label style={{ fontSize: 13, fontWeight: 600 }}>Room Number</label>
          <input
            style={loginInputStyle}
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="1234"
          />

          <button
            style={{
              width: "100%",
              padding: 14,
              border: "none",
              borderRadius: 12,
              background: "#25D366",
              color: "#fff",
              fontWeight: 700,
              cursor: joining ? "not-allowed" : "pointer",
              opacity: joining ? 0.7 : 1,
            }}
            onClick={joinRoom}
            disabled={joining}
          >
            {joining ? "Joining..." : "Join"}
          </button>
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
        minHeight: "100vh",
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
          height: "100vh",
          background: "#EFEAE2",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Chat client={client} theme="messaging light">
          <Channel channel={channel}>
            <Window>
              <WebRTCCall roomId={room} myName={name} />

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  backgroundImage:
                    "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)",
                  backgroundSize: "18px 18px",
                }}
              >
                <MessageList Message={MyMessage} />
              </div>

              <div
                style={{
                  padding: "0 14px 4px",
                  background: "#EFEAE2",
                }}
              >
                <TypingIndicator />
              </div>

              <div
                style={{
                  padding: 10,
                  borderTop: "1px solid rgba(0,0,0,0.06)",
                  background: "#F0F2F5",
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
                  <div style={{ flex: 1 }}>
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
            </Window>

            <Thread />
          </Channel>
        </Chat>
      </div>
    </div>
  );
}

const loginInputStyle = {
  width: "100%",
  padding: 12,
  marginTop: 6,
  marginBottom: 14,
  borderRadius: 12,
  border: "1px solid #d9d9d9",
  outline: "none",
};