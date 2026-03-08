import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();

/* Allowed frontend origins */
const allowedOrigins = [
  "https://myroom-n1bl.vercel.app",
  "http://localhost:5173",
];

/* Express CORS */
app.use(
  cors({
    origin(origin, callback) {
      // allow requests with no origin (mobile apps, curl, same-server calls)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

/* Health check route */
app.get("/", (_req, res) => {
  res.send("Backend is running");
});

/* Token route */
app.post("/api/token", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const apiKey = process.env.STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res
      .status(500)
      .json({ error: "Missing STREAM_API_KEY or STREAM_API_SECRET in Render environment variables" });
  }

  try {
    const serverClient = StreamChat.getInstance(apiKey, apiSecret);
    const token = serverClient.createToken(userId);

    return res.json({ token });
  } catch (error) {
    console.error("Token creation error:", error);
    return res.status(500).json({ error: "Failed to create token" });
  }
});

/* Create HTTP server */
const httpServer = createServer(app);

/* Socket.IO */
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
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
    if (!roomId) return;
    socket.to(roomId).emit("signal", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* Start server */
const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});