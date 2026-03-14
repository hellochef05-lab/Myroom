import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!allowedOrigins.includes("http://localhost:5173")) {
  allowedOrigins.push("http://localhost:5173");
}

if (!allowedOrigins.includes("https://myroom-ms7g.onrender.com")) {
  allowedOrigins.push("https://myroom-ms7g.onrender.com");
}

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for origin: ${origin}`));
      }
    },
    credentials: true,
  })
);

const streamApiKey = process.env.STREAM_API_KEY;
const streamApiSecret = process.env.STREAM_API_SECRET;

if (!streamApiKey || !streamApiSecret) {
  console.error("Missing STREAM_API_KEY or STREAM_API_SECRET");
}

const serverClient = StreamChat.getInstance(streamApiKey, streamApiSecret);

app.get("/", (_req, res) => {
  res.send("Backend is running");
});

app.post("/api/token", async (req, res) => {
  try {
    const { userId, name, room } = req.body;

    if (!userId || !name || !room) {
      return res.status(400).json({
        error: "userId, name, and room are required",
      });
    }

    await serverClient.upsertUser({
      id: userId,
      name,
      role: "user",
    });

    const channel = serverClient.channel("messaging", room, {
      name: `Room ${room}`,
      created_by_id: userId,
    });

    await channel.watch();

    const currentMembers = Object.keys(channel.state.members || {});
    if (!currentMembers.includes(userId)) {
      await channel.addMembers([userId]);
    }

    const token = serverClient.createToken(userId);

    return res.json({ token });
  } catch (err) {
    console.error("token route error:", err);
    console.error("token route body:", req.body);
    return res.status(500).json({
      error: "Failed to create token",
      details: err.message,
    });
  }
});

app.post("/api/delete-all-rooms", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_DELETE_KEY) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const filters = { type: "messaging" };
    const sort = [{ last_message_at: -1 }];

    const channels = await serverClient.queryChannels(filters, sort, {
      limit: 100,
    });

    if (!channels.length) {
      return res.json({
        success: true,
        message: "No rooms found",
        deleted: 0,
      });
    }

    const cids = channels.map((channel) => channel.cid);

    const response = await serverClient.deleteChannels(cids);
    const result = await serverClient.getTask(response.task_id);

    return res.json({
      success: true,
      message: "All rooms deleted",
      deleted: cids.length,
      task_status: result.status,
      room_ids: cids,
    });
  } catch (err) {
    console.error("delete all rooms error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to delete all rooms",
      details: err.message,
    });
  }
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Socket.IO CORS blocked for origin: ${origin}`));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room: ${roomId}`);
  });

  socket.on("leave-room", ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room: ${roomId}`);
  });

  socket.on("signal", ({ roomId, data }) => {
    if (!roomId || !data) return;
    socket.to(roomId).emit("signal", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});