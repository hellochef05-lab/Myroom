import { useEffect, useRef, useState } from "react";
import { StreamChat } from "stream-chat";
import {
  Chat,
  Channel,
  MessageInput,
  MessageList,
  Thread,
  Window,
  useChannelStateContext,
} from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";

import { Mic, Paperclip, Phone, Video } from "lucide-react";
import { io } from "socket.io-client";

const apiKey = import.meta.env.VITE_STREAM_API_KEY;
// parse TURN servers from env (JSON array of {urls,username,credential})
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

/** Voice note button that records audio and uploads to Stream as a file */
function VoiceNoteButton() {
  const { channel } = useChannelStateContext();
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, {
          type: "audio/webm",
        });

        const uploaded = await channel.sendFile(file);

        await channel.sendMessage({
          text: "",
          attachments: [
            {
              type: "file",
              asset_url: uploaded.file,
              title: "Voice note",
              mime_type: "audio/webm",
            },
          ],
        });

        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (e) {
      alert("Microphone permission denied or not available.");
      console.error(e);
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    setRecording(false);
  };

  return (
    <button
      onClick={recording ? stopRecording : startRecording}
      title={recording ? "Stop recording" : "Record voice note"}
      style={{
        padding: "10px",
        borderRadius: "999px",
        border: "1px solid #ddd",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Mic size={18} />
      <span style={{ fontSize: 12 }}>{recording ? "Stop" : "Voice"}</span>
    </button>
  );
}

/** WhatsApp-like top header with call buttons */
function CallHeader({ room, onStartAudio, onStartVideo, onEndCall, inCall, callType }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderBottom: "1px solid #eee",
      }}
    >
      <div style={{ fontWeight: 700 }}>Room {room}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {inCall && (
          <div style={{ color: "green", fontWeight: 600 }}>
            {callType === "video" ? "Video Call Active" : "Audio Call Active"}
          </div>
        )}

        <button
          onClick={() => {
            console.log("CallHeader: audio button clicked");
            onStartAudio();
          }}
          title="Audio Call"
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid #eee",
            cursor: "pointer",
            background: "white",
          }}
        >
          <Phone size={18} />
        </button>

        <button
          onClick={() => {
            console.log("CallHeader: video button clicked");
            onStartVideo();
          }}
          title="Video Call"
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid #eee",
            cursor: "pointer",
            background: "white",
          }}
        >
          <Video size={18} />
        </button>

        {inCall && (
          <button
            onClick={() => {
              console.log("CallHeader: end call clicked");
              onEndCall();
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #eee",
              cursor: "pointer",
            }}
          >
            End Call
          </button>
        )}
      </div>
    </div>
  );
}

/** WebRTC Call UI (NO JITSI, NO LINKS) */
function WebRTCCall({ roomId, myName }) {
  const socketRef = useRef(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  // we'll keep a state copy of the remote stream so we can react when it changes
  const [remoteStream, setRemoteStream] = useState(null);
  // debug info for ICE/connection
  const [pcState, setPcState] = useState({ ice: null, conn: null });

  const iceQueueRef = useRef([]);
  const pendingOfferRef = useRef(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  // remoteMediaStreamRef was unused, remove it

  const isCallerRef = useRef(false);
  const acceptedRef = useRef(false);

  const [inCall, setInCall] = useState(false);
  const [incoming, setIncoming] = useState(null); // { callType, from }
  const [callType, setCallType] = useState(null);
  const screenStreamRef = useRef(null);

  // socket connect once
  useEffect(() => {
    const s = io("https://myroom-ms7g.onrender.com", {
      transports: ["polling", "websocket"],
      reconnection: true,
    });

    s.on("connect", () => console.log("socket connected", s.id));
    s.on("disconnect", (reason) => console.log("socket disconnected", reason));
    s.on("connect_error", (err) => console.warn("socket connect_error", err));

    socketRef.current = s;

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  // join room
  useEffect(() => {
    const s = socketRef.current;
    if (!s || !roomId) return;

    s.emit("join-room", { roomId });

    return () => {
      s.emit("leave-room", { roomId });
    };
  }, [roomId]);


const createPC = () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        // allow injected TURN servers from environment (as JSON string)
        ...turnServers,
        // public STUN/TURN fallback for quick testing (metered.ca openrelay)
        {
          urls: "stun:stun.l.google.com:19302",
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        // note: the openrelay server above has very limited bandwidth and
        // is meant for development/testing only.  For production you should
        // provide your own TURN server through VITE_TURN_SERVERS.
      ],
    });

    // don't attach a MediaStream to event.streams, so fall back to
    // creating/merging manually and propagate via state so refs can
    // update after they mount.
    pc.ontrack = (event) => {
      console.log("Remote track received:", event.track.kind, event.streams);

      let stream = event.streams && event.streams[0];
      if (!stream) {
        // either use existing stream or make a new one and add track
        stream = remoteStream || new MediaStream();
        if (!stream.getTracks().some((t) => t.id === event.track.id)) {
          stream.addTrack(event.track);
        }
      }

      setRemoteStream(stream);
    };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("local ICE candidate", event.candidate);
      socketRef.current?.emit("signal", {
        roomId,
        data: {
          type: "ice",
          candidate: event.candidate,
        },
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
    setPcState((s) => ({ ...s, conn: pc.connectionState }));
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      console.warn("PeerConnection failed/disconnected");
      cleanupCall();
      alert("Call failed: unable to establish a direct connection. Ensure TURN is configured.");
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", pc.iceConnectionState);
    setPcState((s) => ({ ...s, ice: pc.iceConnectionState }));
    if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
      console.warn("ICE connection state indicates failure", pc.iceConnectionState);
      cleanupCall();
      alert("ICE negotiation failed. Try again or check TURN servers.");
    }
  };

  pcRef.current = pc;
  return pc;
};

const startLocalMedia = async (type) => {
    if (!pcRef.current) createPC();

    const constraints =
      type === "video"
        ? { video: true, audio: true }
        : { video: false, audio: true };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;

    console.log(
      "Local tracks:",
      stream.getTracks().map((t) => `${t.kind}:${t.readyState}`)
    );

    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });

    stream.getTracks().forEach((track) => {
      const alreadyAdded = pcRef.current
        .getSenders()
        .some((sender) => sender.track && sender.track.id === track.id);

      if (!alreadyAdded) {
        pcRef.current.addTrack(track, stream);
        console.log("Added local track:", track.kind);
      }
    });

    if (type === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.volume = 0;
      localVideoRef.current.play?.().catch(() => {});
    } else if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    return stream;
  };
  const cleanupCall = () => {
    setInCall(false);
    setIncoming(null);
    setCallType(null);
    // stop and remove any screen tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    acceptedRef.current = false;
    isCallerRef.current = false;

    pendingOfferRef.current = null;
    iceQueueRef.current = [];

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

    // clear the state-stream as well
    if (remoteStream) {
      remoteStream.getTracks().forEach((t) => t.stop());
      setRemoteStream(null);
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

const handleOffer = async (data) => {
  if (!pcRef.current) createPC();
  const pc = pcRef.current;

  const ct = data.callType || "audio";
  setCallType(ct);

  await startLocalMedia(ct);

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  for (const c of iceQueueRef.current) {
    await pc.addIceCandidate(c);
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

  console.log(
    "Caller senders:",
    pc.getSenders().map((s) => s.track?.kind)
  );

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socketRef.current?.emit("signal", {
    roomId,
    data: { type: "offer", offer, callType: type },
  });
};

  // listen signals
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onSignal = async (data) => {
      try {
        console.log("received signal", data.type, data.callType || "");
        if (data.type === "call") {
          // reset any previous call state
          cleanupCall();
          setIncoming({ callType: data.callType, from: data.from || "Someone" });
          return;
        }

        if (data.type === "accept") {
          // caller sends offer ONLY after accept
          if (isCallerRef.current && !pcRef.current) {
            await startOfferFlow(data.callType || callType || "audio");
          }
          return;
        }

        if (data.type === "offer") {
          // receiver: wait until user clicks Answer
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

          for (const c of iceQueueRef.current) {
            await pc.addIceCandidate(c).catch((err) =>
              console.warn("ice add error", err)
            );
          }
          iceQueueRef.current = [];

          setInCall(true);
          return;
        }

        if (data.type === "ice") {
          const pc = pcRef.current;
          if (!pc) return;

          const candidate = new RTCIceCandidate(data.candidate);
          console.log("adding remote candidate", candidate);
          if (!pc.remoteDescription) {
            iceQueueRef.current.push(candidate);
          } else {
            await pc.addIceCandidate(candidate).catch((err) =>
              console.warn("ice add error", err)
            );
          }
          return;
        }

        if (data.type === "hangup") {
          cleanupCall();
          return;
        }
      } catch (e) {
        console.error("Signal error:", e);
      }
    };

    s.on("signal", onSignal);
    return () => s.off("signal", onSignal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callType, roomId]);

  const startCall = async (type) => {
    console.log("startCall invoked", type, "socket connected?", socketRef.current?.connected);
    if (!socketRef.current) {
      console.warn("startCall aborted: no socket");
      return;
    }
    if (inCall || pcRef.current) {
      console.warn("startCall aborted: already in call or pc exists");
      return;
    }

    setCallType(type);
    isCallerRef.current = true;

    // unmute the audio element as this originates from a user click
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(() => {});
    }

    socketRef.current.emit("signal", {
      roomId,
      data: { type: "call", callType: type, from: myName },
    });
  };

  const answerCall = async () => {
    console.log("answerCall invoked", { incoming });
    acceptedRef.current = true;

    // hide popup
    setIncoming(null);

    // unmute on user interaction
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(() => {});
    }

    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "accept", callType: incoming?.callType || "audio" },
    });

    // if offer already arrived, handle now
    if (pendingOfferRef.current) {
      const offerData = pendingOfferRef.current;
      pendingOfferRef.current = null;
      await handleOffer(offerData);
    }
  };

  const declineCall = () => {
    socketRef.current?.emit("signal", { roomId, data: { type: "hangup" } });
    setIncoming(null);
    acceptedRef.current = false;
    pendingOfferRef.current = null;
  };

  const hangup = () => {
    socketRef.current?.emit("signal", { roomId, data: { type: "hangup" } });
    cleanupCall();
  };

  // whenever remoteStream updates we need to push it into
  // any mounted media elements. a small effect handles that.
  useEffect(() => {
    if (remoteStream) {
      console.log("remoteStream tracks", remoteStream.getTracks());
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current
          .play()
          .catch((e) => console.log("Remote video play blocked:", e));
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1;
        // try to play, and if blocked add a one-time click listener
        let interactionHandler;
        remoteAudioRef.current
          .play()
          .catch((e) => {
            console.log("Remote audio play blocked, will retry on interaction:", e);
            interactionHandler = () => {
              remoteAudioRef.current?.play().catch(() => {});
            };
            document.addEventListener("click", interactionHandler, { once: true });
          });
        // cleanup listener just in case
        return () => {
          if (interactionHandler) {
            document.removeEventListener("click", interactionHandler);
          }
        };
      }
    }
  }, [remoteStream]);

  // if we just entered a call retry playback (some browsers require it)
  useEffect(() => {
    if (inCall && remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [inCall]);

  return (
    <div style={{ position: "relative" }}>
      <CallHeader
        room={roomId}
        onStartAudio={() => startCall("audio")}
        onStartVideo={() => startCall("video")}
        onEndCall={hangup}
        inCall={inCall}
        callType={callType}
      />
      {inCall && (
        <button
          onClick={async () => {
            try {
              if (!pcRef.current) createPC();
              const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
              screenStreamRef.current = screenStream;
              screenStream.getTracks().forEach((track) => {
                pcRef.current.addTrack(track, screenStream);
                track.onended = () => {
                  const sender = pcRef.current
                    .getSenders()
                    .find((s) => s.track === track);
                  if (sender) pcRef.current.removeTrack(sender);
                };
              });
            } catch (e) {
              console.error("screen share failed", e);
            }
          }}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            padding: "6px 10px",
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 8,
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          📺 Share Screen
        </button>
      )}
      {/* debug status */}
      <div style={{ position: "absolute", top: 50, left: 10, fontSize: 12, color: "white" }}>
        {/* show connection/ice state */}
        Conn: {pcState.conn || "-"}, ICE: {pcState.ice || "-"}
        <br />
        Remote tracks: {remoteStream?.getTracks().length || 0}
      </div>
      {/* start muted so autoplay can succeed; we'll unmute on user interaction */}
      <audio ref={remoteAudioRef} autoPlay playsInline muted />

      {incoming && !inCall && (
        <div
          style={{
            margin: 10,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>
              {incoming.callType === "video" ? "📹 Incoming video call" : "📞 Incoming audio call"}
            </div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>from {incoming.from}</div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={answerCall}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
            >
              ✅ Answer
            </button>
            <button
              onClick={declineCall}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
            >
              ❌ Decline
            </button>
          </div>
        </div>
      )}

      {inCall && (
        <div
          style={{
            margin: 10,
            border: "1px solid #ddd",
            borderRadius: 12,
            overflow: "hidden",
            background: "#000",
            position: "relative",
            height: 420,
          }}
        >
          <button
            onClick={hangup}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 2,
              padding: "6px 10px",
              background: "white",
              border: "1px solid #ddd",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            End Call
          </button>

          {callType === "video" ? (
  <>
    <video
      ref={remoteVideoRef}
      autoPlay
      playsInline
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />

    <video
      ref={localVideoRef}
      autoPlay
      muted
      playsInline
      style={{
        position: "absolute",
        bottom: 10,
        right: 10,
        width: 140,
        height: 100,
        objectFit: "cover",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.25)",
      }}
    />
  </>
) : (
  <div
    style={{
      color: "white",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 20,
      fontWeight: 700,
    }}
  >
    Audio Call Connected
  </div>
)}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [client, setClient] = useState(null);
  const [channel, setChannel] = useState(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");

  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (client) client.disconnectUser();
    };
  }, [client]);

  // Create/watch channel once client + room are ready
  useEffect(() => {
    if (!client || !room) return;
    let cancelled = false;

    const init = async () => {
      try {
        const ch = client.channel("messaging", room, { name: `Room ${room}` });
        await ch.watch();
        if (!cancelled) setChannel(ch);
      } catch (e) {
        console.error(e);
        if (!cancelled) setChannel(null);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [client, room]);

  const [joining, setJoining] = useState(false);

  async function joinRoom() {
    console.log("joinRoom called", { name, room });
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

  if (!client) {
    return (
      <div style={{ maxWidth: 420, margin: "60px auto", padding: 20 }}>
        <h2>Private Chat Room</h2>

        <label>Your Name</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 12 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="User"
        />

        <label>Room Number</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 12 }}
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="1234"
        />

        <button
          style={{ width: "100%", padding: 12, cursor: "pointer" }}
          onClick={joinRoom}
        >
          Join
        </button>
      </div>
    );
  }

  if (!channel) return <div style={{ padding: 20 }}>Loading chat…</div>;

  return (
    <Chat client={client} theme="messaging light">
      <Channel channel={channel}>
        <Window>
          {/* ✅ Free WhatsApp-like call (WebRTC) — no Jitsi, no 8x8 links */}
          <WebRTCCall roomId={room} myName={name} />

          <MessageList />

          {/* Bottom bar: attach + input + voice note */}
          <div style={{ display: "flex", gap: 10, padding: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 6px",
              }}
              title="Attach files (use the upload button inside the message input)"
            >
              <Paperclip size={18} />
            </div>

            <div style={{ flex: 1 }}>
              <MessageInput multipleUploads accept="image/*,video/*" />
            </div>

            <VoiceNoteButton />
          </div>
        </Window>

        <Thread />
      </Channel>
    </Chat>
  );
}