import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";

dotenv.config();

dotenv.config();

const app = express();
app.use(express.json());

const DB_FILE = new URL("./db.json", import.meta.url).pathname;

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    console.error("DB file not found:", DB_FILE);

    return {
      plans: [],
      users: [],
      devices: [],
      rooms: [],
      supportRequests: [],
      supportMessages: []
    };
  }

  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAdmin(req) {
  return req.headers["x-admin-pin"] === process.env.ADMIN_PIN;
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

[
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://myroom-ms7g.onrender.com",
  "https://myroom-n1bl.vercel.app",
].forEach((origin) => {
  if (!allowedOrigins.includes(origin)) {
    allowedOrigins.push(origin);
  }
});

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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-admin-pin",
      "x-admin-key",
    ],
  })
);

app.options(/.*/, cors());

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
    const { userId, name, username, room, roomCode, accessKey } = req.body || {};

    const displayName = name || username || "Guest";
    const finalRoom = room || roomCode;

    if (!finalRoom) {
      return res.status(400).json({
        error: "Room is required",
      });
    }

    const db = readDB();

    if (!Array.isArray(db.users)) db.users = [];

    const accessKeyInput = String(accessKey || "").trim().toLowerCase();
    const userIdInput = String(userId || "").trim().toLowerCase();

    const user = db.users.find((item) => {
      const savedAccessKey = String(item.accessKey || "").trim().toLowerCase();
      const savedUserId = String(item.id || "").trim().toLowerCase();

      return (
        savedAccessKey === accessKeyInput ||
        savedAccessKey === userIdInput ||
        savedUserId === userIdInput
      );
    });

    if (!user) {
      return res.status(401).json({
        error: "Invalid Access Key",
      });
    }

    if (user.status === "blocked") {
      return res.status(403).json({
        error: "User account is blocked",
      });
    }

    if (user.subscriptionStatus === "blocked") {
      return res.status(403).json({
        error: "Subscription is blocked",
      });
    }

    if (user.subscriptionEnd) {
      const today = new Date();
      const expiryDate = new Date(user.subscriptionEnd);

      if (expiryDate < today) {
        return res.status(403).json({
          error: "Subscription expired",
        });
      }
    }

    const finalAccessKey = user.accessKey;

    const streamUserId = `user_${String(finalAccessKey)
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 40)}`;

    await serverClient.upsertUser({
      id: streamUserId,
      name: displayName,
      role: "user",
    });

    const channel = serverClient.channel("messaging", finalRoom, {
      name: `Room ${finalRoom}`,
      created_by_id: streamUserId,
    });

    await channel.watch();
    await channel.addMembers([streamUserId]);

    const token = serverClient.createToken(streamUserId);

    res.json({
      token,
      userId: streamUserId,
      name: displayName,
      room: finalRoom,
      accessKey: finalAccessKey,
    });
  } catch (err) {
    console.error("Token route error:", err);
    res.status(500).json({
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

  socket.on("join-room", ({ roomId }, ack) => {
    if (!roomId) {
      if (ack) ack({ ok: false });
      return;
    }

    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room: ${roomId}`);

    if (ack) ack({ ok: true, roomId });
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
app.get("/api/delete-all-rooms-shortcut", async (req, res) => {
  try {
    const key = req.query.key;

    if (key !== process.env.DELETE_SHORTCUT_KEY) {
      return res.status(403).send("Unauthorized");
    }

    const filters = { type: "messaging" };
    const sort = [{ last_message_at: -1 }];

    const channels = await serverClient.queryChannels(filters, sort, {
      limit: 100,
    });

    if (!channels.length) {
      return res.send("No rooms found");
    }

    const cids = channels.map((channel) => channel.cid);

    const response = await serverClient.deleteChannels(cids);
    const result = await serverClient.getTask(response.task_id);

    return res.send(
      `Success. Deleted ${cids.length} rooms. Task status: ${result.status}`
    );
  } catch (err) {
    console.error("delete shortcut error:", err);
    return res.status(500).send(`Failed: ${err.message}`);
  }
});
app.get("/api/plans", (req, res) => {
  const db = readDB();
  res.json(db.plans.filter((plan) => plan.active));
});

app.post("/api/admin/plans/:planId", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { planId } = req.params;
  const { name, price, days, active } = req.body;

  const db = readDB();
  const plan = db.plans.find((p) => p.id === planId);

  if (!plan) {
    return res.status(404).json({ error: "Plan not found" });
  }

  if (name !== undefined) plan.name = name;
  if (price !== undefined) plan.price = Number(price);
  if (days !== undefined) plan.days = Number(days);
  if (active !== undefined) plan.active = Boolean(active);

  writeDB(db);

  res.json({
    success: true,
    plan
  });
});
app.post("/api/admin/users", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const {
    username,
    accessKey,
    subscriptionEnd,
    deviceLimit = 2,
    status = "active"
  } = req.body;

  if (!username || !accessKey || !subscriptionEnd) {
    return res.status(400).json({
      error: "username, accessKey and subscriptionEnd are required"
    });
  }

  const db = readDB();

  const exists = db.users.find(
    (u) => u.username === username || u.accessKey === accessKey
  );

  if (exists) {
    return res.status(409).json({
      error: "Username or Access Key already exists"
    });
  }

  const user = {
    id: makeId("user"),
    username,
    accessKey,
    subscriptionStart: new Date().toISOString(),
    subscriptionEnd,
    deviceLimit: Number(deviceLimit),
    status,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  writeDB(db);

  res.json({
    success: true,
    user
  });
});
app.post("/api/login", (req, res) => {
  const {
  username = "",
  name = "",
  accessKey = "",
  deviceId = "",
  deviceName = "",
} = req.body || {};

const displayName = username || name || "Guest";
  

  const db = readDB();

  const user = db.users.find(
  (u) =>
    String(u.accessKey || "").trim().toLowerCase() ===
    String(accessKey || "").trim().toLowerCase()
);

  if (!user) {
    return res.status(401).json({ error: "Invalid Access Key" });
  }

  if (user.status !== "active") {
    return res.status(403).json({ error: "User account is blocked" });
  }

  const today = new Date();
  const subscriptionEnd = new Date(user.subscriptionEnd);

  if (subscriptionEnd < today) {
    return res.status(403).json({ error: "Subscription expired" });
  }

  const userDevices = db.devices.filter(
    (d) => d.accessKey === accessKey && d.status === "active"
  );

  const existingDevice = userDevices.find((d) => d.deviceId === deviceId);

  if (existingDevice) {
    existingDevice.lastLoginAt = new Date().toISOString();
    writeDB(db);

    return res.json({
      success: true,
      user,
      devicesUsed: userDevices.length,
      deviceLimit: user.deviceLimit
    });
  }

  if (userDevices.length >= user.deviceLimit) {
    return res.status(403).json({
      error: `Device limit reached. This Access Key is allowed on ${user.deviceLimit} devices only.`
    });
  }

  db.devices.push({
    id: makeId("device"),
    userId: user.id,
    accessKey,
    deviceId,
    deviceName: deviceName || "Unknown Device",
    status: "active",
    firstLoginAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  });

  writeDB(db);

  res.json({
    success: true,
    user,
    devicesUsed: userDevices.length + 1,
    deviceLimit: user.deviceLimit
  });
});
app.post("/api/admin/users/:userId/device-limit", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { userId } = req.params;
  const { deviceLimit } = req.body;

  if (!deviceLimit) {
    return res.status(400).json({ error: "Device limit is required" });
  }

  const db = readDB();
  const user = db.users.find((u) => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  user.deviceLimit = Number(deviceLimit);
  user.updatedAt = new Date().toISOString();

  writeDB(db);

  res.json({
    success: true,
    user
  });
});
app.post("/api/support/public", (req, res) => {
  const { name, contact, accessKey, issueType, message } = req.body;

  if (!name || !contact || !issueType || !message) {
    return res.status(400).json({
      error: "Name, contact, issue type and message are required"
    });
  }

  const db = readDB();

  const request = {
    id: makeId("support"),
    userId: null,
    accessKey: accessKey || null,
    roomId: null,
    roomName: null,
    guestName: name,
    guestContact: contact,
    issueType,
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const supportMessage = {
    id: makeId("msg"),
    supportRequestId: request.id,
    senderType: "user",
    senderId: null,
    accessKey: accessKey || null,
    roomId: null,
    message,
    isRead: false,
    createdAt: new Date().toISOString()
  };

  db.supportRequests.push(request);
  db.supportMessages.push(supportMessage);

  writeDB(db);

  res.json({
    success: true,
    request
  });
});
app.get("/api/admin/support", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { accessKey } = req.query;

  const db = readDB();

  let requests = db.supportRequests;

  if (accessKey) {
    requests = requests.filter((request) => request.accessKey === accessKey);
  }

  const result = requests.map((request) => {
    const messages = db.supportMessages.filter(
      (message) => message.supportRequestId === request.id
    );

    const user = request.userId
      ? db.users.find((u) => u.id === request.userId)
      : null;

    return {
      ...request,
      user,
      messages
    };
  });

  res.json(result);
});
app.post("/api/admin/support/:requestId/reply", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { requestId } = req.params;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  const db = readDB();

  const request = db.supportRequests.find((r) => r.id === requestId);

  if (!request) {
    return res.status(404).json({ error: "Support request not found" });
  }

  const reply = {
    id: makeId("msg"),
    supportRequestId: requestId,
    senderType: "admin",
    senderId: "admin",
    accessKey: request.accessKey,
    roomId: request.roomId,
    message,
    isRead: false,
    createdAt: new Date().toISOString()
  };

  request.status = "waiting_for_user";
  request.updatedAt = new Date().toISOString();

  db.supportMessages.push(reply);

  writeDB(db);

  res.json({
    success: true,
    reply
  });
});
app.post("/api/support/room", (req, res) => {
  try {
    const {
      userId,
      accessKey,
      roomId,
      roomName,
      deviceId,
      issueType,
      message
    } = req.body;

    if (!userId || !accessKey || !roomId || !message) {
      return res.status(400).json({
        error: "Missing required fields",
        received: req.body
      });
    }

    const db = readDB();

    if (!Array.isArray(db.supportRequests)) db.supportRequests = [];
    if (!Array.isArray(db.supportMessages)) db.supportMessages = [];
    if (!Array.isArray(db.users)) db.users = [];

    const user = db.users.find(
      (u) => u.id === userId && u.accessKey === accessKey
    );

    if (!user) {
      return res.status(401).json({
        error: "Invalid user or Access Key"
      });
    }

    const request = {
      id: makeId("support"),
      userId,
      accessKey,
      roomId,
      roomName: roomName || `Room ${roomId}`,
      deviceId: deviceId || null,
      issueType: issueType || "Room issue",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const supportMessage = {
      id: makeId("msg"),
      supportRequestId: request.id,
      senderType: "user",
      senderId: userId,
      accessKey,
      roomId,
      message,
      isRead: false,
      createdAt: new Date().toISOString()
    };

    db.supportRequests.push(request);
    db.supportMessages.push(supportMessage);

    writeDB(db);

    return res.json({
      success: true,
      request
    });
  } catch (err) {
    console.error("room support error:", err);

    return res.status(500).json({
      error: err.message
    });
  }
});
function generateFiveDigitAccessKey(db) {
  let accessKey = "";

  do {
    accessKey = String(Math.floor(10000 + Math.random() * 90000));
  } while (db.users?.some((user) => user.accessKey === accessKey));

  return accessKey;
}

function addDaysToDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 30));
  return date.toISOString().slice(0, 10);
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}
function checkAdminPin(req, res) {
  const adminPin = req.headers["x-admin-pin"];
  const correctPin = process.env.ADMIN_PIN || "123456";

  if (adminPin !== correctPin) {
    res.status(403).json({ error: "Invalid admin PIN" });
    return false;
  }

  return true;
}

app.get("/api/payment-settings", (req, res) => {
  res.json({
    upiId: process.env.UPI_ID || "9781723138@sbi",
    upiName: process.env.UPI_NAME || "Private Room Subscription",
  });
});

app.get("/api/payment-settings", (req, res) => {
  res.json({
    upiId: process.env.UPI_ID || "9781723138@sbi",
    upiName: process.env.UPI_NAME || "Private Room Subscription",
  });
});

app.post("/api/subscribe/request", (req, res) => {
  try {
    const { username, contact, planId, upiReference } = req.body;

    if (!username || !contact || !planId || !upiReference) {
      return res.status(400).json({
        error: "username, contact, planId, and UPI reference are required",
      });
    }

    const db = readDB();
    if (!Array.isArray(db.payments)) db.payments = [];

const existingPayment = db.payments.find(
  (payment) =>
    String(payment.upiReference || "").trim().toLowerCase() ===
    String(upiReference || "").trim().toLowerCase()
);

if (existingPayment) {
  return res.json({
    success: true,
    alreadySubmitted: true,
    status: existingPayment.status,
    paymentId: existingPayment.id,
    accessKey: existingPayment.accessKey || "",
    username: existingPayment.username,
    contact: existingPayment.contact,
    planName: existingPayment.planName,
    amount: existingPayment.amount,
    days: existingPayment.days,
    adminComment: existingPayment.adminComment || "",
    rejectionReason: existingPayment.rejectionReason || "",
    createdAt: existingPayment.createdAt,
    approvedAt: existingPayment.approvedAt || "",
    rejectedAt: existingPayment.rejectedAt || "",
    message:
      existingPayment.status === "approved"
        ? `Approved. Your Access Key is ${existingPayment.accessKey}`
        : existingPayment.status === "rejected"
        ? `Rejected. ${existingPayment.rejectionReason || existingPayment.adminComment || ""}`
        : "Your payment request is already pending admin approval.",
  });
}

    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.plans)) db.plans = [];
    if (!Array.isArray(db.payments)) db.payments = [];

    const plan = db.plans.find((item) => item.id === planId);

    if (!plan) {
      return res.status(404).json({
        error: "Plan not found",
      });
    }

    const existingUser = db.users.find(
      (user) =>
        String(user.username).toLowerCase() === String(username).toLowerCase()
    );

    if (existingUser) {
      return res.status(409).json({
        error: "Username already exists. Please choose another username.",
      });
    }

    const existingReference = db.payments.find(
      (payment) =>
        String(payment.upiReference).toLowerCase() ===
        String(upiReference).toLowerCase()
    );

    if (existingReference) {
      return res.status(409).json({
        error: "This UPI reference number was already submitted.",
      });
    }

    const payment = {
      id: makeId("payment"),
      username,
      contact,
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      days: plan.days,
      upiReference,
      upiId: process.env.UPI_ID || "9781723138@sbi",
      status: "pending",
      accessKey: "",
      userId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvedAt: "",
      rejectedAt: "",
      rejectionReason: "",
    };

    db.payments.push(payment);
    writeDB(db);

    return res.json({
      success: true,
      payment,
      message: "Payment submitted. Please wait for admin approval.",
    });
  } catch (err) {
    console.error("subscribe request error:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
});

app.get("/api/subscribe/status/:paymentId", (req, res) => {
  try {
    const { paymentId } = req.params;

    const db = readDB();

    if (!Array.isArray(db.payments)) db.payments = [];

    const payment = db.payments.find((item) => item.id === paymentId);

    if (!payment) {
      return res.status(404).json({
        error: "Payment request not found",
      });
    }

    return res.json({
      id: payment.id,
      username: payment.username,
      contact: payment.contact,
      planName: payment.planName,
      amount: payment.amount,
      status: payment.status,
      accessKey: payment.status === "approved" ? payment.accessKey : "",
      rejectionReason: payment.rejectionReason || "",
    });
  } catch (err) {
    console.error("payment status error:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
});

app.get("/api/admin/payments", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();

  if (!Array.isArray(db.payments)) db.payments = [];

  const payments = [...db.payments].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  res.json(payments);
});

app.post("/api/admin/payments/:paymentId/approve", (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;

    const { paymentId } = req.params;
    const { comment } = req.body || {};

    const db = readDB();

    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.payments)) db.payments = [];

    const payment = db.payments.find((item) => item.id === paymentId);

    if (!payment) {
      return res.status(404).json({
        error: "Payment request not found",
      });
    }

    if (payment.status === "approved") {
      return res.status(400).json({
        error: "Payment is already approved",
      });
    }

    if (payment.status === "rejected") {
      return res.status(400).json({
        error: "Rejected payment cannot be approved",
      });
    }

    const existingUser = db.users.find(
      (user) =>
        String(user.username).toLowerCase() ===
        String(payment.username).toLowerCase()
    );

    if (existingUser) {
      return res.status(409).json({
        error: "Username already exists. Cannot approve payment.",
      });
    }

    const accessKey = generateFiveDigitAccessKey(db);

    const user = {
      id: makeId("user"),
      username: payment.username,
      contact: payment.contact,
      accessKey,
      deviceLimit: 2,
      subscriptionStart: getTodayDate(),
      subscriptionEnd: addDaysToDate(payment.days),
      subscriptionStatus: "active",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.users.push(user);

    payment.status = "approved";
payment.accessKey = accessKey;
payment.userId = user.id;
payment.approvedAt = new Date().toISOString();
payment.updatedAt = new Date().toISOString();
payment.adminComment = comment || payment.adminComment || "Payment approved by admin";
payment.commentUpdatedAt = new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      user,
      payment,
      accessKey,
      message: "Payment approved. Access Key generated.",
    });
  } catch (err) {
    console.error("approve payment error:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
});

app.post("/api/admin/payments/:paymentId/reject", (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;

    const { paymentId } = req.params;
    const { reason, comment } = req.body || {};

    const db = readDB();

    if (!Array.isArray(db.payments)) db.payments = [];

    const payment = db.payments.find((item) => item.id === paymentId);

    if (!payment) {
      return res.status(404).json({
        error: "Payment request not found",
      });
    }

    if (payment.status === "approved") {
      return res.status(400).json({
        error: "Approved payment cannot be rejected",
      });
    }

    payment.status = "rejected";
payment.rejectionReason = reason || "Payment rejected by admin";
payment.rejectedAt = new Date().toISOString();
payment.updatedAt = new Date().toISOString();
payment.adminComment = comment || reason || "Payment rejected by admin";
payment.commentUpdatedAt = new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      payment,
      message: "Payment rejected.",
    });
  } catch (err) {
    console.error("reject payment error:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
});
app.get("/api/admin/users", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();

  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.devices)) db.devices = [];
  if (!Array.isArray(db.rooms)) db.rooms = [];
  if (!Array.isArray(db.supportRequests)) db.supportRequests = [];

  const users = db.users.map((user) => {
    const devices = db.devices.filter(
      (device) => device.accessKey === user.accessKey
    );

    const rooms = db.rooms.filter(
      (room) => room.accessKey === user.accessKey
    );

    const supportTickets = db.supportRequests.filter(
      (ticket) => ticket.accessKey === user.accessKey
    );

    return {
      ...user,
      devicesUsed: devices.length,
      roomsCount: rooms.length,
      supportTicketsCount: supportTickets.length,
    };
  });

  res.json(users);
});

app.get("/api/admin/rooms", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();

  if (!Array.isArray(db.rooms)) db.rooms = [];
  if (!Array.isArray(db.users)) db.users = [];

  const { accessKey } = req.query;

  let rooms = db.rooms;

  if (accessKey) {
    rooms = rooms.filter((room) => room.accessKey === accessKey);
  }

  const result = rooms.map((room) => {
    const user = db.users.find((u) => u.accessKey === room.accessKey);

    return {
      ...room,
      username: user?.username || room.ownerName || "Unknown",
      subscriptionEnd: user?.subscriptionEnd || "",
      userStatus: user?.status || "unknown",
    };
  });

  res.json(result);
});
app.patch("/api/admin/plans/:planId", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { planId } = req.params;
  const { name, price, days } = req.body;

  const db = readDB();

  if (!Array.isArray(db.plans)) db.plans = [];

  const plan = db.plans.find((item) => item.id === planId);

  if (!plan) {
    return res.status(404).json({ error: "Plan not found" });
  }

  if (name !== undefined) plan.name = name;
  if (price !== undefined) plan.price = Number(price);
  if (days !== undefined) plan.days = Number(days);

  plan.updatedAt = new Date().toISOString();

  writeDB(db);

  res.json({
    success: true,
    plan,
  });
});
app.patch("/api/admin/users/:userId", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { userId } = req.params;
  const {
    username,
    contact,
    accessKey,
    subscriptionEnd,
    deviceLimit,
    status,
    subscriptionStatus,
  } = req.body;

  const db = readDB();

  if (!Array.isArray(db.users)) db.users = [];

  const user = db.users.find((item) => item.id === userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (username !== undefined) user.username = username;
  if (contact !== undefined) user.contact = contact;
  if (accessKey !== undefined) user.accessKey = accessKey;
  if (subscriptionEnd !== undefined) user.subscriptionEnd = subscriptionEnd;
  if (deviceLimit !== undefined) user.deviceLimit = Number(deviceLimit);
  if (status !== undefined) user.status = status;
  if (subscriptionStatus !== undefined) user.subscriptionStatus = subscriptionStatus;

  user.updatedAt = new Date().toISOString();

  writeDB(db);

  res.json({
    success: true,
    user,
  });
});
app.post("/api/admin/users/:userId/extend", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { userId } = req.params;
  const { days } = req.body;

  const db = readDB();

  if (!Array.isArray(db.users)) db.users = [];

  const user = db.users.find((item) => item.id === userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const today = new Date();
  const currentEnd = user.subscriptionEnd
    ? new Date(user.subscriptionEnd)
    : today;

  const baseDate = currentEnd > today ? currentEnd : today;
  baseDate.setDate(baseDate.getDate() + Number(days || 30));

  user.subscriptionEnd = baseDate.toISOString().slice(0, 10);
  user.subscriptionStatus = "active";
  user.status = "active";
  user.updatedAt = new Date().toISOString();

  writeDB(db);

  res.json({
    success: true,
    user,
  });
});
app.patch("/api/admin/support/:requestId/status", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { requestId } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "open",
    "in_progress",
    "waiting_for_user",
    "solved",
    "closed",
    "archived",
    "rejected",
  ];

  if (!status || !allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: "Invalid ticket status",
    });
  }

  const db = readDB();

  if (!Array.isArray(db.supportRequests)) db.supportRequests = [];

  const ticket = db.supportRequests.find((item) => item.id === requestId);

  if (!ticket) {
    return res.status(404).json({
      error: "Support ticket not found",
    });
  }

  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();

  if (status === "closed" || status === "solved") {
    ticket.closedAt = new Date().toISOString();
  }

  writeDB(db);

  res.json({
    success: true,
    ticket,
  });
});
app.post("/api/admin/rooms/delete-by-access-key", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { accessKey } = req.body;

  if (!accessKey) {
    return res.status(400).json({
      error: "Access Key is required",
    });
    app.post("/api/admin/rooms/delete-by-access-key", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { accessKey } = req.body;

  if (!accessKey) {
    return res.status(400).json({
      error: "Access Key is required",
    });
  }

  const db = readDB();

  if (!Array.isArray(db.rooms)) db.rooms = [];

  const beforeCount = db.rooms.length;

  db.rooms = db.rooms.filter((room) => room.accessKey !== accessKey);

  const deleted = beforeCount - db.rooms.length;

  writeDB(db);

  res.json({
    success: true,
    deleted,
    message: `Deleted ${deleted} room(s) for Access Key ${accessKey}`,
  });
});
  }

  const db = readDB();

  if (!Array.isArray(db.rooms)) db.rooms = [];

  const beforeCount = db.rooms.length;

  db.rooms = db.rooms.filter((room) => room.accessKey !== accessKey);

  const deleted = beforeCount - db.rooms.length;

  writeDB(db);

  res.json({
    success: true,
    deleted,
    message: `Deleted ${deleted} room(s) for Access Key ${accessKey}`,
  });
});
app.get("/api/support/:accessKey", (req, res) => {
  const { accessKey } = req.params;

  const db = readDB();

  if (!Array.isArray(db.supportRequests)) db.supportRequests = [];
  if (!Array.isArray(db.supportMessages)) db.supportMessages = [];

  const userTickets = db.supportRequests
    .filter(
      (ticket) =>
        String(ticket.accessKey || "").trim().toLowerCase() ===
        String(accessKey || "").trim().toLowerCase()
    )
    .map((ticket) => {
      const messages = db.supportMessages.filter(
        (msg) => msg.supportRequestId === ticket.id
      );

      return {
        ...ticket,
        messages,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(userTickets);
});

app.post("/api/support", (req, res) => {
  const {
  accessKey,
  username,
  contact = "",
  roomName,
  roomId,
  issueType = "Support",
  message,
  deviceId = "",
} = req.body || {};

  if (!accessKey || !message) {
    return res.status(400).json({
      error: "Access Key and message are required",
    });
  }

  const db = readDB();

  if (!Array.isArray(db.supportRequests)) db.supportRequests = [];
  if (!Array.isArray(db.supportMessages)) db.supportMessages = [];

  const normalizedAccessKey = String(accessKey || "").trim().toLowerCase();

const existingOpenTicket =
  normalizedAccessKey !== "public"
    ? db.supportRequests.find(
        (ticket) =>
          String(ticket.accessKey || "").trim().toLowerCase() ===
            normalizedAccessKey &&
          ticket.status !== "closed" &&
          ticket.status !== "solved" &&
          ticket.status !== "archived"
      )
    : null;

  let ticket = existingOpenTicket;

  if (!ticket) {
    ticket = {
  id: makeId("support"),
  userId: "",
  accessKey,
  username: username || "Guest",
  contact,
  roomId: roomId || "",
  roomName: roomName || "",
  deviceId,
  issueType,
  status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: "",
    };

    db.supportRequests.push(ticket);
  }

  const supportMessage = {
    id: makeId("msg"),
    supportRequestId: ticket.id,
    userId: "",
    accessKey,
    roomId: roomId || "",
    senderType: "user",
    senderId: accessKey,
    message,
    attachmentUrl: "",
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  db.supportMessages.push(supportMessage);

  ticket.updatedAt = new Date().toISOString();

  if (ticket.status === "waiting_for_user") {
    ticket.status = "open";
  }

  writeDB(db);

  res.json({
    success: true,
    ticket,
    message: supportMessage,
  });
});

app.post("/api/support/:requestId/reply", (req, res) => {
  const { requestId } = req.params;
  const { accessKey, message } = req.body || {};

  if (!message) {
    return res.status(400).json({
      error: "Message is required",
    });
  }

  const db = readDB();

  if (!Array.isArray(db.supportRequests)) db.supportRequests = [];
  if (!Array.isArray(db.supportMessages)) db.supportMessages = [];

  const ticket = db.supportRequests.find((item) => item.id === requestId);

  if (!ticket) {
    return res.status(404).json({
      error: "Support ticket not found",
    });
  }
  if (
  ticket.status === "closed" ||
  ticket.status === "solved" ||
  ticket.status === "archived"
) {
  return res.status(403).json({
    error: "This support ticket is closed. Replies are disabled.",
  });
}

  if (
    accessKey &&
    String(ticket.accessKey || "").trim().toLowerCase() !==
      String(accessKey || "").trim().toLowerCase()
  ) {
    return res.status(403).json({
      error: "This ticket does not belong to this Access Key",
    });
  }

  const supportMessage = {
    id: makeId("msg"),
    supportRequestId: ticket.id,
    userId: "",
    accessKey: ticket.accessKey,
    roomId: ticket.roomId || "",
    senderType: "user",
    senderId: ticket.accessKey,
    message,
    attachmentUrl: "",
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  db.supportMessages.push(supportMessage);

  ticket.status = "open";
  ticket.updatedAt = new Date().toISOString();

  writeDB(db);

  res.json({
    success: true,
    ticket,
    message: supportMessage,
  });
});

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
