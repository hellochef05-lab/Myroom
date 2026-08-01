import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());

const DB_FILE = new URL("./db.json", import.meta.url).pathname;

function createEmptyDB() {
  return {
    plans: [],
    users: [],
    devices: [],
    rooms: [],
    payments: [],
    supportRequests: [],
    supportMessages: [],
  };
}

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const db = createEmptyDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const defaults = createEmptyDB();

  for (const key of Object.keys(defaults)) {
    if (!Array.isArray(db[key])) {
      db[key] = [];
    }
  }

  return db;
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function safeId(value) {
  return normalize(value)
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 120);
}

function sameValue(a, b) {
  return normalize(a) === normalize(b);
}

function isAdmin(req) {
  return (
    req.headers["x-admin-pin"] ===
    (process.env.ADMIN_PIN || "123456")
  );
}

function checkAdminPin(req, res) {
  if (!isAdmin(req)) {
    res.status(403).json({
      error: "Invalid admin PIN",
    });

    return false;
  }

  return true;
}

function getActiveUserByAccessKey(db, accessKey) {
  const user = db.users.find((item) =>
    sameValue(item.accessKey, accessKey)
  );

  if (!user) {
    return {
      error: "Invalid Access Key",
      status: 401,
      subscriptionStatus: "invalid",
    };
  }

  const changed = updateSubscriptionStatus(user);

  if (changed) {
    writeDB(db);
  }

  if (user.status === "blocked") {
    return {
      error: "User account is blocked",
      status: 403,
      subscriptionStatus: user.subscriptionStatus,
      user,
    };
  }

  if (user.status !== "active") {
    return {
      error: "User account is inactive",
      status: 403,
      subscriptionStatus: user.subscriptionStatus,
      user,
    };
  }

  if (user.subscriptionStatus === "blocked") {
    return {
      error: "Subscription is blocked",
      status: 403,
      subscriptionStatus: "blocked",
      user,
    };
  }

  if (user.subscriptionStatus === "expired") {
    return {
      error: "Subscription expired",
      status: 403,
      subscriptionStatus: "expired",
      subscriptionEnd: user.subscriptionEnd,
      user,
    };
  }

  return {
    user,
    subscriptionStatus: "active",
  };
}

function generateFiveDigitAccessKey(db) {
  let accessKey;

  do {
    accessKey = String(
      Math.floor(10000 + Math.random() * 90000)
    );
  } while (
    db.users.some((user) =>
      sameValue(user.accessKey, accessKey)
    )
  );

  return accessKey;
}

function getDubaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(
      parts.find((part) => part.type === "year")?.value
    ),
    month: Number(
      parts.find((part) => part.type === "month")?.value
    ),
    day: Number(
      parts.find((part) => part.type === "day")?.value
    ),
  };
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0"
  )}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarMonthsToDate(months, purchaseDate = new Date()) {
  const { year, month, day } = getDubaiDateParts(purchaseDate);

  const totalMonths =
    year * 12 + (month - 1) + Number(months || 1);

  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const targetMonth = targetMonthIndex + 1;

  const targetDay = Math.min(
    day,
    daysInMonth(targetYear, targetMonth)
  );

  return formatDate(targetYear, targetMonth, targetDay);
}

function addSubscriptionDate(planName, purchaseDate = new Date()) {
  const normalizedPlanName = normalize(planName);

  if (normalizedPlanName === "monthly plan") {
    return addCalendarMonthsToDate(1, purchaseDate);
  }

  if (normalizedPlanName === "3 month plan") {
    return addCalendarMonthsToDate(3, purchaseDate);
  }

  if (normalizedPlanName === "yearly plan") {
    return addCalendarMonthsToDate(12, purchaseDate);
  }

  return addCalendarMonthsToDate(1, purchaseDate);
}

function getTodayDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function updateSubscriptionStatus(user) {
  if (!user) {
    return false;
  }

  if (user.subscriptionStatus === "blocked") {
    return false;
  }

  const today = getTodayDate();

  const expiryDate = String(
    user.subscriptionEnd || ""
  ).slice(0, 10);

  if (!expiryDate) {
    if (!user.subscriptionStatus) {
      user.subscriptionStatus = "active";
      user.updatedAt = new Date().toISOString();
      return true;
    }

    return false;
  }

  if (today >= expiryDate) {
    if (user.subscriptionStatus !== "expired") {
      user.subscriptionStatus = "expired";
      user.updatedAt = new Date().toISOString();
      return true;
    }

    return false;
  }

  if (
    user.subscriptionStatus === "expired" ||
    !user.subscriptionStatus
  ) {
    user.subscriptionStatus = "active";
    user.updatedAt = new Date().toISOString();
    return true;
  }

  return false;
}

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

for (const origin of [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://myroom-ms7g.onrender.com",
  "https://myroom-n1bl.vercel.app",
]) {
  if (!allowedOrigins.includes(origin)) {
    allowedOrigins.push(origin);
  }
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  return (
    allowedOrigins.includes(origin) ||
    origin.endsWith(".vercel.app")
  );
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(
        new Error(`CORS blocked for origin: ${origin}`)
      );
    }
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-admin-pin",
    "x-admin-key",
  ],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

const streamApiKey = process.env.STREAM_API_KEY;
const streamApiSecret = process.env.STREAM_API_SECRET;

if (!streamApiKey || !streamApiSecret) {
  console.error(
    "Missing STREAM_API_KEY or STREAM_API_SECRET"
  );
}

const serverClient = StreamChat.getInstance(
  streamApiKey,
  streamApiSecret
);

async function deleteStreamChannels(roomIds) {
  const uniqueIds = [
    ...new Set(
      roomIds
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ];

  if (uniqueIds.length === 0) {
    return [];
  }

  const cids = uniqueIds.map(
    (id) => `messaging:${id}`
  );

  const response = await serverClient.deleteChannels(cids);

  if (response?.task_id) {
    await serverClient.getTask(response.task_id);
  }

  return uniqueIds;
}

app.get("/", (_req, res) => {
  res.send("Backend is running");
});

app.post("/api/token", async (req, res) => {
  try {
    const {
      userId,
      name,
      username,
      room,
      roomCode,
      accessKey,
    } = req.body || {};

    const displayName =
      name || username || "Guest";

    const finalRoom = String(
      roomCode || room || ""
    ).trim();

    if (!finalRoom) {
      return res.status(400).json({
        error: "Room is required",
      });
    }

    const db = readDB();

    const auth = getActiveUserByAccessKey(
      db,
      accessKey || userId
    );

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error,
        subscriptionStatus:
          auth.subscriptionStatus || "invalid",
        subscriptionEnd:
          auth.subscriptionEnd ||
          auth.user?.subscriptionEnd ||
          "",
      });
    }

    const finalAccessKey = String(
      auth.user.accessKey
    );

    const providedUserId = safeId(userId);

    if (!providedUserId) {
      return res.status(400).json({
        error: "Unique user ID is required",
      });
    }

    const expectedPrefix =
      `key_${safeId(finalAccessKey)}_user_`;

    if (!providedUserId.startsWith(expectedPrefix)) {
      return res.status(403).json({
        error:
          "Invalid user identity for this Access Key",
      });
    }

    await serverClient.upsertUser({
      id: providedUserId,
      name: displayName,
      role: "user",
    });

    const safeRoomCode = safeId(finalRoom);

    const privateRoomId =
      `key_${safeId(finalAccessKey)}` +
      `_room_${safeRoomCode}`;

    const now = new Date().toISOString();

    const existingRoom = db.rooms.find(
      (savedRoom) =>
        savedRoom.id === privateRoomId &&
        sameValue(
          savedRoom.accessKey,
          finalAccessKey
        )
    );

    if (!existingRoom) {
      db.rooms.push({
        id: privateRoomId,
        roomId: safeRoomCode,
        roomName: finalRoom,
        accessKey: finalAccessKey,
        ownerName: displayName,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      existingRoom.roomName = finalRoom;
      existingRoom.ownerName = displayName;
      existingRoom.status = "active";
      existingRoom.updatedAt = now;
    }

    writeDB(db);

    const channel = serverClient.channel(
      "messaging",
      privateRoomId,
      {
        name: `Room ${finalRoom}`,
        accessKey: finalAccessKey,
        created_by_id: providedUserId,
        members: [providedUserId],
      }
    );

    try {
      await channel.create();
    } catch (error) {
      if (
        !normalize(error?.message).includes(
          "already exists"
        )
      ) {
        throw error;
      }
    }

    try {
      await channel.addMembers([providedUserId]);
    } catch (error) {
      console.warn(
        "Add member warning:",
        error.message
      );
    }

    const token = serverClient.createToken(
      providedUserId
    );

    return res.json({
      token,
      userId: providedUserId,
      name: displayName,
      room: privateRoomId,
      accessKey: finalAccessKey,
      subscriptionStatus:
        auth.user.subscriptionStatus || "active",
      subscriptionEnd:
        auth.user.subscriptionEnd || "",
    });
  } catch (error) {
    console.error(
      "Token route error:",
      error
    );

    return res.status(500).json({
      error: "Failed to create token",
      details: error.message,
    });
  }
});

app.post("/api/login", (req, res) => {
  const {
    username = "",
    name = "",
    accessKey = "",
    deviceId = "",
    deviceName = "",
  } = req.body || {};

  const displayName =
    username || name || "Guest";

  if (!accessKey || !deviceId) {
    return res.status(400).json({
      error:
        "Access Key and device ID are required",
    });
  }

  const db = readDB();

  const auth = getActiveUserByAccessKey(
    db,
    accessKey
  );

  if (auth.error) {
    return res.status(auth.status).json({
      success: false,
      error: auth.error,
      subscriptionStatus:
        auth.subscriptionStatus || "invalid",
      subscriptionEnd:
        auth.subscriptionEnd ||
        auth.user?.subscriptionEnd ||
        "",
      accessKey:
        auth.user?.accessKey || "",
    });
  }

  const user = auth.user;
  const canonicalKey = String(user.accessKey);

  const deviceLimit = Number(
    user.deviceLimit || 2
  );

  const activeDevices = db.devices.filter(
    (device) =>
      sameValue(
        device.accessKey,
        canonicalKey
      ) &&
      device.status === "active"
  );

  const existingDevice = activeDevices.find(
    (device) =>
      device.deviceId === deviceId
  );

  const streamUserId =
    `key_${safeId(canonicalKey)}` +
    `_user_${safeId(deviceId)}`;

  if (existingDevice) {
    existingDevice.lastLoginAt =
      new Date().toISOString();

    existingDevice.deviceName =
      deviceName ||
      existingDevice.deviceName ||
      "Unknown Device";

    existingDevice.streamUserId =
      streamUserId;

    writeDB(db);

    return res.json({
      success: true,
      user,
      displayName,
      streamUserId,
      devicesUsed: activeDevices.length,
      deviceLimit,
      subscriptionStatus:
        user.subscriptionStatus || "active",
      subscriptionEnd:
        user.subscriptionEnd || "",
    });
  }

  if (activeDevices.length >= deviceLimit) {
    return res.status(403).json({
      success: false,
      error:
        `Device limit reached. This Access Key ` +
        `is allowed on ${deviceLimit} devices only.`,
      subscriptionStatus:
        user.subscriptionStatus || "active",
      subscriptionEnd:
        user.subscriptionEnd || "",
    });
  }

  db.devices.push({
    id: makeId("device"),
    userId: user.id,
    accessKey: canonicalKey,
    deviceId,
    deviceName:
      deviceName || "Unknown Device",
    streamUserId,
    status: "active",
    firstLoginAt:
      new Date().toISOString(),
    lastLoginAt:
      new Date().toISOString(),
  });

  writeDB(db);

  return res.json({
    success: true,
    user,
    displayName,
    streamUserId,
    devicesUsed:
      activeDevices.length + 1,
    deviceLimit,
    subscriptionStatus:
      user.subscriptionStatus || "active",
    subscriptionEnd:
      user.subscriptionEnd || "",
  });
});

app.get(
  "/api/rooms/:accessKey",
  (req, res) => {
    const db = readDB();

    const auth = getActiveUserByAccessKey(
      db,
      req.params.accessKey
    );

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error,
        subscriptionStatus:
          auth.subscriptionStatus || "invalid",
        subscriptionEnd:
          auth.subscriptionEnd ||
          auth.user?.subscriptionEnd ||
          "",
      });
    }

    const rooms = db.rooms
      .filter((room) =>
        sameValue(
          room.accessKey,
          auth.user.accessKey
        )
      )
      .sort(
        (a, b) =>
          new Date(
            b.updatedAt || b.createdAt
          ) -
          new Date(
            a.updatedAt || a.createdAt
          )
      );

    return res.json(rooms);
  }
);

app.post(
  "/api/rooms/delete-one",
  async (req, res) => {
    try {
      const {
        accessKey,
        roomId,
      } = req.body || {};

      if (!accessKey || !roomId) {
        return res.status(400).json({
          error:
            "Access Key and room ID are required",
        });
      }

      const db = readDB();

      const auth =
        getActiveUserByAccessKey(
          db,
          accessKey
        );

      if (auth.error) {
        return res
          .status(auth.status)
          .json({
            error: auth.error,
            subscriptionStatus:
              auth.subscriptionStatus ||
              "invalid",
            subscriptionEnd:
              auth.subscriptionEnd ||
              auth.user?.subscriptionEnd ||
              "",
          });
      }

      const room = db.rooms.find(
        (item) =>
          item.id === roomId &&
          sameValue(
            item.accessKey,
            auth.user.accessKey
          )
      );

      if (!room) {
        return res.status(404).json({
          error:
            "Room not found for this Access Key",
        });
      }

      await deleteStreamChannels([
        room.id,
      ]);

      db.rooms = db.rooms.filter(
        (item) =>
          !(
            item.id === room.id &&
            sameValue(
              item.accessKey,
              auth.user.accessKey
            )
          )
      );

      writeDB(db);

      return res.json({
        success: true,
        deleted: 1,
        deletedRooms: [room.id],
        message:
          "Selected room deleted successfully",
      });
    } catch (error) {
      console.error(
        "Delete one room error:",
        error
      );

      return res.status(500).json({
        error: "Failed to delete room",
        details: error.message,
      });
    }
  }
);

app.post(
  "/api/rooms/delete-multiple",
  async (req, res) => {
    try {
      const {
        accessKey,
        roomIds,
      } = req.body || {};

      if (
        !accessKey ||
        !Array.isArray(roomIds) ||
        roomIds.length === 0
      ) {
        return res.status(400).json({
          error:
            "Access Key and at least one room ID are required",
        });
      }

      const db = readDB();

      const auth =
        getActiveUserByAccessKey(
          db,
          accessKey
        );

      if (auth.error) {
        return res
          .status(auth.status)
          .json({
            error: auth.error,
            subscriptionStatus:
              auth.subscriptionStatus ||
              "invalid",
            subscriptionEnd:
              auth.subscriptionEnd ||
              auth.user?.subscriptionEnd ||
              "",
          });
      }

      const requestedIds = new Set(
        roomIds.map(String)
      );

      const ownedRooms = db.rooms.filter(
        (room) =>
          requestedIds.has(
            String(room.id)
          ) &&
          sameValue(
            room.accessKey,
            auth.user.accessKey
          )
      );

      if (ownedRooms.length === 0) {
        return res.status(404).json({
          error:
            "No matching rooms found for this Access Key",
        });
      }

      const ownedIds = ownedRooms.map(
        (room) => room.id
      );

      await deleteStreamChannels(
        ownedIds
      );

      const deletedSet = new Set(
        ownedIds
      );

      db.rooms = db.rooms.filter(
        (room) =>
          !(
            deletedSet.has(room.id) &&
            sameValue(
              room.accessKey,
              auth.user.accessKey
            )
          )
      );

      writeDB(db);

      return res.json({
        success: true,
        deleted: ownedIds.length,
        deletedRooms: ownedIds,
        message:
          `${ownedIds.length} selected room(s) deleted successfully`,
      });
    } catch (error) {
      console.error(
        "Delete multiple rooms error:",
        error
      );

      return res.status(500).json({
        error: "Failed to delete rooms",
        details: error.message,
      });
    }
  }
);

app.post(
  "/api/rooms/delete-by-access-key",
  async (req, res) => {
    try {
      const {
        accessKey,
      } = req.body || {};

      if (!accessKey) {
        return res.status(400).json({
          error:
            "Access Key is required",
        });
      }

      const db = readDB();

      const auth =
        getActiveUserByAccessKey(
          db,
          accessKey
        );

      if (auth.error) {
        return res
          .status(auth.status)
          .json({
            error: auth.error,
            subscriptionStatus:
              auth.subscriptionStatus ||
              "invalid",
            subscriptionEnd:
              auth.subscriptionEnd ||
              auth.user?.subscriptionEnd ||
              "",
          });
      }

      const roomsToDelete =
        db.rooms.filter((room) =>
          sameValue(
            room.accessKey,
            auth.user.accessKey
          )
        );

      const roomIds =
        roomsToDelete.map(
          (room) => room.id
        );

      await deleteStreamChannels(
        roomIds
      );

      db.rooms = db.rooms.filter(
        (room) =>
          !sameValue(
            room.accessKey,
            auth.user.accessKey
          )
      );

      writeDB(db);

      return res.json({
        success: true,
        deleted: roomIds.length,
        deletedRooms: roomIds,
        message:
          `Deleted ${roomIds.length} room(s) for this Access Key`,
      });
    } catch (error) {
      console.error(
        "Delete rooms by Access Key error:",
        error
      );

      return res.status(500).json({
        error: "Failed to delete rooms",
        details: error.message,
      });
    }
  }
);

app.get("/api/plans", (_req, res) => {
  const db = readDB();

  if (db.plans.length === 0) {
    const now =
      new Date().toISOString();

    db.plans = [
      {
        id: "monthly",
        name: "Monthly Plan",
        price: 29,
        days: 30,
        active: true,
        updatedAt: now,
      },
      {
        id: "three_month",
        name: "3 Month Plan",
        price: 75,
        days: 90,
        active: true,
        updatedAt: now,
      },
      {
        id: "yearly",
        name: "Yearly Plan",
        price: 299,
        days: 365,
        active: true,
        updatedAt: now,
      },
    ];

    writeDB(db);
  }

  return res.json(
    db.plans.filter(
      (plan) =>
        plan.active !== false
    )
  );
});

app.get(
  "/api/payment-settings",
  (_req, res) => {
    res.json({
      upiId:
        process.env.UPI_ID ||
        "9781723138@sbi",

      upiName:
        process.env.UPI_NAME ||
        "Private Room Subscription",
    });
  }
);

app.post(
  "/api/subscribe/request",
  (req, res) => {
    try {
      const {
        username,
        contact,
        planId,
        upiReference,
      } = req.body || {};

      if (
        !username ||
        !contact ||
        !planId ||
        !upiReference
      ) {
        return res.status(400).json({
          error:
            "username, contact, planId, and UPI reference are required",
        });
      }

      const db = readDB();

      const existingPayment =
        db.payments.find(
          (payment) =>
            sameValue(
              payment.upiReference,
              upiReference
            )
        );

      if (existingPayment) {
        return res.json({
          success: true,
          alreadySubmitted: true,
          status:
            existingPayment.status,
          paymentId:
            existingPayment.id,
          accessKey:
            existingPayment.accessKey ||
            "",
          payment: existingPayment,
        });
      }

      const plan = db.plans.find(
        (item) =>
          item.id === planId
      );

      if (!plan) {
        return res.status(404).json({
          error: "Plan not found",
        });
      }

      if (
        db.users.some((user) =>
          sameValue(
            user.username,
            username
          )
        )
      ) {
        return res.status(409).json({
          error:
            "Username already exists. Please choose another username.",
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

        upiId:
          process.env.UPI_ID ||
          "9781723138@sbi",

        status: "pending",
        accessKey: "",
        userId: "",

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString(),

        approvedAt: "",
        rejectedAt: "",
        rejectionReason: "",
        adminComment: "",
      };

      db.payments.push(payment);
      writeDB(db);

      return res.json({
        success: true,
        payment,
        message:
          "Payment submitted. Please wait for admin approval.",
      });
    } catch (error) {
      console.error(
        "Subscription request error:",
        error
      );

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/subscribe/status/:paymentId",
  (req, res) => {
    const db = readDB();

    const payment =
      db.payments.find(
        (item) =>
          item.id ===
          req.params.paymentId
      );

    if (!payment) {
      return res.status(404).json({
        error:
          "Payment request not found",
      });
    }

    let user = null;

    if (payment.userId) {
      user = db.users.find(
        (item) =>
          item.id === payment.userId
      );
    }

    if (user) {
      const changed =
        updateSubscriptionStatus(user);

      if (changed) {
        writeDB(db);
      }
    }

    return res.json({
      ...payment,

      accessKey:
        payment.status === "approved"
          ? payment.accessKey
          : "",

      subscriptionStatus:
        user?.subscriptionStatus || "",

      subscriptionStart:
        user?.subscriptionStart || "",

      subscriptionEnd:
        user?.subscriptionEnd || "",
    });
  }
);

app.post(
  "/api/support/public",
  (req, res) => {
    const {
      name,
      contact,
      accessKey,
      issueType,
      message,
    } = req.body || {};

    if (
      !name ||
      !contact ||
      !issueType ||
      !message
    ) {
      return res.status(400).json({
        error:
          "Name, contact, issue type and message are required",
      });
    }

    const db = readDB();

    const request = {
      id: makeId("support"),
      userId: null,
      accessKey:
        accessKey || null,
      roomId: null,
      roomName: null,
      guestName: name,
      guestContact: contact,
      issueType,
      status: "open",

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    };

    const supportMessage = {
      id: makeId("msg"),
      supportRequestId:
        request.id,
      senderType: "user",
      senderId: null,
      accessKey:
        accessKey || null,
      roomId: null,
      message,
      isRead: false,

      createdAt:
        new Date().toISOString(),
    };

    db.supportRequests.push(
      request
    );

    db.supportMessages.push(
      supportMessage
    );

    writeDB(db);

    return res.json({
      success: true,
      request,
    });
  }
);

app.post(
  "/api/support/room",
  (req, res) => {
    const {
      userId,
      accessKey,
      roomId,
      roomName,
      deviceId,
      issueType,
      message,
    } = req.body || {};

    if (
      !userId ||
      !accessKey ||
      !roomId ||
      !message
    ) {
      return res.status(400).json({
        error:
          "userId, Access Key, room ID and message are required",
      });
    }

    const db = readDB();

    const auth =
      getActiveUserByAccessKey(
        db,
        accessKey
      );

    if (auth.error) {
      return res
        .status(auth.status)
        .json({
          error: auth.error,
          subscriptionStatus:
            auth.subscriptionStatus ||
            "invalid",
          subscriptionEnd:
            auth.subscriptionEnd ||
            auth.user?.subscriptionEnd ||
            "",
        });
    }

    if (auth.user.id !== userId) {
      return res.status(403).json({
        error:
          "This user does not belong to this Access Key",
      });
    }

    const ownedRoom =
      db.rooms.find(
        (room) =>
          room.id === roomId &&
          sameValue(
            room.accessKey,
            auth.user.accessKey
          )
      );

    if (!ownedRoom) {
      return res.status(403).json({
        error:
          "This room does not belong to this Access Key",
      });
    }

    const request = {
      id: makeId("support"),
      userId,

      accessKey: String(
        auth.user.accessKey
      ),

      roomId,

      roomName:
        roomName ||
        ownedRoom.roomName ||
        `Room ${roomId}`,

      deviceId:
        deviceId || null,

      issueType:
        issueType ||
        "Room issue",

      status: "open",

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    };

    const supportMessage = {
      id: makeId("msg"),

      supportRequestId:
        request.id,

      senderType: "user",
      senderId: userId,

      accessKey: String(
        auth.user.accessKey
      ),

      roomId,
      message,
      isRead: false,

      createdAt:
        new Date().toISOString(),
    };

    db.supportRequests.push(
      request
    );

    db.supportMessages.push(
      supportMessage
    );

    writeDB(db);

    return res.json({
      success: true,
      request,
    });
  }
);

app.post("/api/support", (req, res) => {
  const {
    accessKey,
    username,
    contact = "",
    roomName = "",
    roomId = "",
    issueType = "Support",
    message,
    deviceId = "",
  } = req.body || {};

  if (!accessKey || !message) {
    return res.status(400).json({
      error:
        "Access Key and message are required",
    });
  }

  const db = readDB();

  if (
    normalize(accessKey) !== "public"
  ) {
    const auth =
      getActiveUserByAccessKey(
        db,
        accessKey
      );

    if (auth.error) {
      return res
        .status(auth.status)
        .json({
          error: auth.error,
          subscriptionStatus:
            auth.subscriptionStatus ||
            "invalid",
          subscriptionEnd:
            auth.subscriptionEnd ||
            auth.user?.subscriptionEnd ||
            "",
        });
    }
  }

  let ticket =
    db.supportRequests.find(
      (item) =>
        sameValue(
          item.accessKey,
          accessKey
        ) &&
        ![
          "closed",
          "solved",
          "archived",
        ].includes(item.status)
    );

  if (!ticket) {
    ticket = {
      id: makeId("support"),
      userId: "",
      accessKey,
      username:
        username || "Guest",
      contact,
      roomId,
      roomName,
      deviceId,
      issueType,
      status: "open",

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),

      closedAt: "",
    };

    db.supportRequests.push(
      ticket
    );
  }

  const supportMessage = {
    id: makeId("msg"),

    supportRequestId:
      ticket.id,

    userId: "",
    accessKey,
    roomId,

    senderType: "user",
    senderId: accessKey,

    message,
    attachmentUrl: "",
    isRead: false,

    createdAt:
      new Date().toISOString(),
  };

  db.supportMessages.push(
    supportMessage
  );

  ticket.status = "open";

  ticket.updatedAt =
    new Date().toISOString();

  writeDB(db);

  return res.json({
    success: true,
    ticket,
    message: supportMessage,
  });
});

app.get(
  "/api/support/:accessKey",
  (req, res) => {
    const db = readDB();

    const auth =
      getActiveUserByAccessKey(
        db,
        req.params.accessKey
      );

    if (auth.error) {
      return res
        .status(auth.status)
        .json({
          error: auth.error,
          subscriptionStatus:
            auth.subscriptionStatus ||
            "invalid",
          subscriptionEnd:
            auth.subscriptionEnd ||
            auth.user?.subscriptionEnd ||
            "",
        });
    }

    const tickets =
      db.supportRequests
        .filter((ticket) =>
          sameValue(
            ticket.accessKey,
            auth.user.accessKey
          )
        )
        .map((ticket) => ({
          ...ticket,

          messages:
            db.supportMessages.filter(
              (message) =>
                message.supportRequestId ===
                ticket.id
            ),
        }))
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

    return res.json(tickets);
  }
);

app.post(
  "/api/support/:requestId/reply",
  (req, res) => {
    const {
      accessKey,
      message,
    } = req.body || {};

    if (!accessKey || !message) {
      return res.status(400).json({
        error:
          "Access Key and message are required",
      });
    }

    const db = readDB();

    const ticket =
      db.supportRequests.find(
        (item) =>
          item.id ===
          req.params.requestId
      );

    if (!ticket) {
      return res.status(404).json({
        error:
          "Support ticket not found",
      });
    }

    if (
      !sameValue(
        ticket.accessKey,
        accessKey
      )
    ) {
      return res.status(403).json({
        error:
          "This ticket does not belong to this Access Key",
      });
    }

    if (
      [
        "closed",
        "solved",
        "archived",
      ].includes(ticket.status)
    ) {
      return res.status(403).json({
        error:
          "This support ticket is closed. Replies are disabled.",
      });
    }

    const auth =
      getActiveUserByAccessKey(
        db,
        accessKey
      );

    if (auth.error) {
      return res
        .status(auth.status)
        .json({
          error: auth.error,
          subscriptionStatus:
            auth.subscriptionStatus ||
            "invalid",
          subscriptionEnd:
            auth.subscriptionEnd ||
            auth.user?.subscriptionEnd ||
            "",
        });
    }

    const reply = {
      id: makeId("msg"),

      supportRequestId:
        ticket.id,

      userId: "",

      accessKey:
        ticket.accessKey,

      roomId:
        ticket.roomId || "",

      senderType: "user",

      senderId:
        ticket.accessKey,

      message,
      attachmentUrl: "",
      isRead: false,

      createdAt:
        new Date().toISOString(),
    };

    db.supportMessages.push(reply);

    ticket.status = "open";

    ticket.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      ticket,
      message: reply,
    });
  }
);

app.post(
  "/api/admin/users",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const {
      username,
      accessKey,
      subscriptionEnd,
      deviceLimit = 2,
      status = "active",
    } = req.body || {};

    if (
      !username ||
      !accessKey ||
      !subscriptionEnd
    ) {
      return res.status(400).json({
        error:
          "username, accessKey and subscriptionEnd are required",
      });
    }

    const db = readDB();

    const exists =
      db.users.some(
        (user) =>
          sameValue(
            user.username,
            username
          ) ||
          sameValue(
            user.accessKey,
            accessKey
          )
      );

    if (exists) {
      return res.status(409).json({
        error:
          "Username or Access Key already exists",
      });
    }

    const user = {
      id: makeId("user"),
      username,
      accessKey,

      subscriptionStart:
        getTodayDate(),

      subscriptionEnd:
        String(subscriptionEnd).slice(
          0,
          10
        ),

      subscriptionStatus:
        getTodayDate() >=
        String(subscriptionEnd).slice(
          0,
          10
        )
          ? "expired"
          : "active",

      deviceLimit:
        Number(deviceLimit) || 2,

      status,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    };

    db.users.push(user);
    writeDB(db);

    return res.json({
      success: true,
      user,
    });
  }
);

app.get(
  "/api/admin/users",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    let statusChanged = false;

    for (const user of db.users) {
      if (
        updateSubscriptionStatus(user)
      ) {
        statusChanged = true;
      }
    }

    if (statusChanged) {
      writeDB(db);
    }

    const users = db.users.map(
      (user) => ({
        ...user,

        devicesUsed:
          db.devices.filter(
            (device) =>
              sameValue(
                device.accessKey,
                user.accessKey
              ) &&
              device.status ===
                "active"
          ).length,

        roomsCount:
          db.rooms.filter(
            (room) =>
              sameValue(
                room.accessKey,
                user.accessKey
              )
          ).length,

        supportTicketsCount:
          db.supportRequests.filter(
            (ticket) =>
              sameValue(
                ticket.accessKey,
                user.accessKey
              )
          ).length,
      })
    );

    return res.json(users);
  }
);

app.patch(
  "/api/admin/users/:userId",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const user = db.users.find(
      (item) =>
        item.id ===
        req.params.userId
    );

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const allowed = [
      "username",
      "contact",
      "accessKey",
      "subscriptionEnd",
      "status",
      "subscriptionStatus",
    ];

    for (const key of allowed) {
      if (
        req.body[key] !== undefined
      ) {
        user[key] = req.body[key];
      }
    }

    if (
      req.body.deviceLimit !==
      undefined
    ) {
      user.deviceLimit = Number(
        req.body.deviceLimit
      );
    }

    if (
      req.body.subscriptionEnd !==
      undefined &&
      req.body.subscriptionStatus ===
        undefined
    ) {
      updateSubscriptionStatus(user);
    }

    user.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      user,
    });
  }
);

app.post(
  "/api/admin/users/:userId/device-limit",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const limit = Number(
      req.body?.deviceLimit
    );

    if (
      !Number.isInteger(limit) ||
      limit < 1
    ) {
      return res.status(400).json({
        error:
          "Valid device limit is required",
      });
    }

    const db = readDB();

    const user = db.users.find(
      (item) =>
        item.id ===
        req.params.userId
    );

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    user.deviceLimit = limit;

    user.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      user,
    });
  }
);

app.post(
  "/api/admin/users/:userId/extend",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const user = db.users.find(
      (item) =>
        item.id ===
        req.params.userId
    );

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const requestedDays = Number(
      req.body?.days || 30
    );

    const monthsToAdd =
      requestedDays >= 365
        ? 12
        : requestedDays >= 90
        ? 3
        : 1;

    const today = getTodayDate();

    const currentEnd = String(
      user.subscriptionEnd || ""
    ).slice(0, 10);

    const baseDateString =
      currentEnd > today
        ? currentEnd
        : today;

    const [
      baseYear,
      baseMonth,
      baseDay,
    ] = baseDateString
      .split("-")
      .map(Number);

    const baseDate = new Date(
      Date.UTC(
        baseYear,
        baseMonth - 1,
        baseDay,
        12,
        0,
        0
      )
    );

    user.subscriptionEnd =
      addCalendarMonthsToDate(
        monthsToAdd,
        baseDate
      );

    user.subscriptionStatus =
      "active";

    user.status = "active";

    user.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      user,
    });
  }
);

app.patch(
  "/api/admin/plans/:planId",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const plan = db.plans.find(
      (item) =>
        item.id ===
        req.params.planId
    );

    if (!plan) {
      return res.status(404).json({
        error: "Plan not found",
      });
    }

    if (
      req.body.name !== undefined
    ) {
      plan.name = req.body.name;
    }

    if (
      req.body.price !== undefined
    ) {
      plan.price = Number(
        req.body.price
      );
    }

    if (
      req.body.days !== undefined
    ) {
      plan.days = Number(
        req.body.days
      );
    }

    if (
      req.body.active !== undefined
    ) {
      plan.active =
        req.body.active === true ||
        req.body.active === "true";
    }

    plan.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      plan,
    });
  }
);

app.get(
  "/api/admin/payments",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const payments = [
      ...db.payments,
    ].sort(
      (a, b) =>
        new Date(b.createdAt) -
        new Date(a.createdAt)
    );

    return res.json(payments);
  }
);

app.post(
  "/api/admin/payments/:paymentId/approve",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const payment =
      db.payments.find(
        (item) =>
          item.id ===
          req.params.paymentId
      );

    if (!payment) {
      return res.status(404).json({
        error:
          "Payment request not found",
      });
    }

    if (
      payment.status !== "pending"
    ) {
      return res.status(400).json({
        error:
          `Payment is already ${payment.status}`,
      });
    }

    if (
      db.users.some((user) =>
        sameValue(
          user.username,
          payment.username
        )
      )
    ) {
      return res.status(409).json({
        error:
          "Username already exists. Cannot approve payment.",
      });
    }

    const accessKey =
      generateFiveDigitAccessKey(db);

    const user = {
      id: makeId("user"),

      username:
        payment.username,

      contact:
        payment.contact,

      accessKey,

      deviceLimit: 2,

      subscriptionStart:
        getTodayDate(),

      subscriptionEnd:
        addSubscriptionDate(
          payment.planName
        ),

      subscriptionStatus:
        "active",

      status: "active",

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    };

    db.users.push(user);

    payment.status = "approved";
    payment.accessKey = accessKey;
    payment.userId = user.id;

    payment.approvedAt =
      new Date().toISOString();

    payment.updatedAt =
      new Date().toISOString();

    payment.adminComment =
      req.body?.comment ||
      "Payment approved by admin";

    writeDB(db);

    return res.json({
      success: true,
      user,
      payment,
      accessKey,

      message:
        "Payment approved. Access Key generated.",
    });
  }
);

app.post(
  "/api/admin/payments/:paymentId/reject",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const payment =
      db.payments.find(
        (item) =>
          item.id ===
          req.params.paymentId
      );

    if (!payment) {
      return res.status(404).json({
        error:
          "Payment request not found",
      });
    }

    if (
      payment.status === "approved"
    ) {
      return res.status(400).json({
        error:
          "Approved payment cannot be rejected",
      });
    }

    payment.status = "rejected";

    payment.rejectionReason =
      req.body?.reason ||
      "Payment rejected by admin";

    payment.adminComment =
      req.body?.comment ||
      payment.rejectionReason;

    payment.rejectedAt =
      new Date().toISOString();

    payment.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      payment,
      message: "Payment rejected.",
    });
  }
);

app.get(
  "/api/admin/rooms",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const rooms =
      req.query.accessKey
        ? db.rooms.filter(
            (room) =>
              sameValue(
                room.accessKey,
                req.query.accessKey
              )
          )
        : db.rooms;

    const result = rooms.map(
      (room) => {
        const user =
          db.users.find(
            (item) =>
              sameValue(
                item.accessKey,
                room.accessKey
              )
          );

        if (user) {
          updateSubscriptionStatus(user);
        }

        return {
          ...room,

          username:
            user?.username ||
            room.ownerName ||
            "Unknown",

          subscriptionEnd:
            user?.subscriptionEnd ||
            "",

          subscriptionStatus:
            user?.subscriptionStatus ||
            "unknown",

          userStatus:
            user?.status ||
            "unknown",
        };
      }
    );

    writeDB(db);

    return res.json(result);
  }
);

app.post(
  "/api/admin/rooms/delete-by-access-key",
  async (req, res) => {
    try {
      if (
        !checkAdminPin(req, res)
      ) {
        return;
      }

      const {
        accessKey,
      } = req.body || {};

      if (!accessKey) {
        return res.status(400).json({
          error:
            "Access Key is required",
        });
      }

      const db = readDB();

      const rooms =
        db.rooms.filter(
          (room) =>
            sameValue(
              room.accessKey,
              accessKey
            )
        );

      const roomIds = rooms.map(
        (room) => room.id
      );

      await deleteStreamChannels(
        roomIds
      );

      db.rooms = db.rooms.filter(
        (room) =>
          !sameValue(
            room.accessKey,
            accessKey
          )
      );

      writeDB(db);

      return res.json({
        success: true,
        deleted:
          roomIds.length,
        deletedRooms:
          roomIds,

        message:
          `Deleted ${roomIds.length} room(s) for Access Key ${accessKey}`,
      });
    } catch (error) {
      console.error(
        "Admin delete rooms error:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to delete rooms",
        details:
          error.message,
      });
    }
  }
);

app.get(
  "/api/admin/support",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const requests =
      req.query.accessKey
        ? db.supportRequests.filter(
            (request) =>
              sameValue(
                request.accessKey,
                req.query.accessKey
              )
          )
        : db.supportRequests;

    const result = requests.map(
      (request) => ({
        ...request,

        user:
          request.userId
            ? db.users.find(
                (user) =>
                  user.id ===
                  request.userId
              ) || null
            : null,

        messages:
          db.supportMessages.filter(
            (message) =>
              message.supportRequestId ===
              request.id
          ),
      })
    );

    return res.json(result);
  }
);

app.post(
  "/api/admin/support/:requestId/reply",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    if (!req.body?.message) {
      return res.status(400).json({
        error:
          "Message is required",
      });
    }

    const db = readDB();

    const request =
      db.supportRequests.find(
        (item) =>
          item.id ===
          req.params.requestId
      );

    if (!request) {
      return res.status(404).json({
        error:
          "Support request not found",
      });
    }

    const reply = {
      id: makeId("msg"),

      supportRequestId:
        request.id,

      senderType: "admin",
      senderId: "admin",

      accessKey:
        request.accessKey,

      roomId:
        request.roomId,

      message:
        req.body.message,

      isRead: false,

      createdAt:
        new Date().toISOString(),
    };

    db.supportMessages.push(reply);

    request.status =
      "waiting_for_user";

    request.updatedAt =
      new Date().toISOString();

    writeDB(db);

    return res.json({
      success: true,
      reply,
    });
  }
);

app.patch(
  "/api/admin/support/:requestId/status",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const allowedStatuses = [
      "open",
      "in_progress",
      "waiting_for_user",
      "solved",
      "closed",
      "archived",
      "rejected",
    ];

    if (
      !allowedStatuses.includes(
        req.body?.status
      )
    ) {
      return res.status(400).json({
        error:
          "Invalid ticket status",
      });
    }

    const db = readDB();

    const ticket =
      db.supportRequests.find(
        (item) =>
          item.id ===
          req.params.requestId
      );

    if (!ticket) {
      return res.status(404).json({
        error:
          "Support ticket not found",
      });
    }

    ticket.status =
      req.body.status;

    ticket.updatedAt =
      new Date().toISOString();

    if (
      [
        "closed",
        "solved",
      ].includes(ticket.status)
    ) {
      ticket.closedAt =
        new Date().toISOString();
    }

    writeDB(db);

    return res.json({
      success: true,
      ticket,
    });
  }
);

const httpServer =
  createServer(app);

const io = new Server(
  httpServer,
  {
    cors: {
      origin: (
        origin,
        callback
      ) => {
        if (
          isAllowedOrigin(origin)
        ) {
          callback(null, true);
        } else {
          callback(
            new Error(
              `Socket.IO CORS blocked for origin: ${origin}`
            )
          );
        }
      },

      methods: [
        "GET",
        "POST",
      ],

      credentials: true,
    },
  }
);

io.on(
  "connection",
  (socket) => {
    console.log(
      "User connected:",
      socket.id
    );

    socket.on(
      "join-room",
      (
        { roomId },
        ack
      ) => {
        if (!roomId) {
          if (ack) {
            ack({
              ok: false,
              error:
                "Room ID is required",
            });
          }

          return;
        }

        socket.join(roomId);

        if (ack) {
          ack({
            ok: true,
            roomId,
          });
        }
      }
    );

    socket.on(
      "leave-room",
      ({ roomId }) => {
        if (roomId) {
          socket.leave(roomId);
        }
      }
    );

    socket.on(
      "signal",
      ({
        roomId,
        data,
      }) => {
        if (
          roomId &&
          data
        ) {
          socket
            .to(roomId)
            .emit(
              "signal",
              data
            );
        }
      }
    );

    socket.on(
      "disconnect",
      () => {
        console.log(
          "User disconnected:",
          socket.id
        );
      }
    );
  }
);

const PORT =
  process.env.PORT || 4000;

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "Server running on port",
      PORT
    );
  }
);