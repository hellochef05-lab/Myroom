import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();

/* Allowed frontend origins (comma-separated env variable for deploys) */
// the list may come from an env var; the check logic below will also allow
// any vercel.app subdomain automatically so you don't need to remember
// to add them during rapid iteration.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
// add common local dev if not provided
if (!allowedOrigins.includes("http://localhost:5173")) {
  allowedOrigins.push("http://localhost:5173");
}
// ensure the render url is allowed too
if (!allowedOrigins.includes("https://myroom-ms7g.onrender.com")) {
  allowedOrigins.push("https://myroom-ms7g.onrender.com");
}

/* Express CORS */
app.use(
  cors({
    origin(origin, callback) {
      // allow requests with no origin (mobile apps, curl, same-server calls)
      if (!origin) return callback(null, true);

      // allow explicit list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // also allow any vercel.app subdomain automatically to avoid
      // forgetting to update env during rapid deploys
      if (origin.endsWith(".vercel.app")) {
        console.log("Permitting vercel.app origin", origin);
        return callback(null, true);
      }

      console.warn(`CORS blocked for origin: ${origin}`);
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
// socket.io CORS: make more permissive for now, logging requests.  we'll
// still keep express routes locked down by the strict middleware above.
const socketCors = {
  origin: (origin, callback) => {
    // origin may be undefined for same-host or mobile requests; allow those
    if (!origin) return callback(null, true);
    console.log("socket.io origin check", origin);
    // allow everything (can tighten later if needed)
    return callback(null, true);
    // example of stricter logic:
    // if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
    //   return callback(null, true);
    // }
    // callback(new Error(`socket.io CORS blocked: ${origin}`));
  },
  methods: ["GET", "POST"],
  credentials: true,
};

const io = new Server(httpServer, {
  cors: socketCors,
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
    console.log(`signal event from ${socket.id} to room ${roomId}`, data.type);
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