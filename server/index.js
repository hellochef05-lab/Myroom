import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.post("/api/token", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const apiKey = process.env.STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: "Missing STREAM_API_KEY/STREAM_API_SECRET in server/.env" });
  }

  const serverClient = StreamChat.getInstance(apiKey, apiSecret);
  const token = serverClient.createToken(userId);

  res.json({ token });
});

/* Create HTTP server */
const httpServer = createServer(app);

/* Socket.IO */
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId }) => {
    socket.join(roomId);
    console.log("Joined room:", roomId);
  });

  socket.on("leave-room", ({ roomId }) => {
    socket.leave(roomId);
  });

  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* Start server */

const PORT = 4000;
httpServer.listen(PORT, () => {
  console.log("Server running on port", PORT);
});