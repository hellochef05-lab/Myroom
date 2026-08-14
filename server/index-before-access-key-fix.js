import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
dotenv.config({
  path: new URL("./.env", import.meta.url).pathname,
});


const app = express();
app.use(express.json());

const supabaseUrl = String(
  process.env.SUPABASE_URL || ""
).trim();

const supabaseSecretKey = String(
  process.env.SUPABASE_SECRET_KEY || ""
).trim();

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SECRET_KEY are required"
  );
}

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

function createEmptyDB() {
  return {
    plans: [],
    users: [],
    devices: [],
    rooms: [],
    payments: [],
    supportRequests: [],
    supportMessages: [],
    loginHistory: [],
  };
}

function normalizeDatabase(value) {
  const source =
    value && typeof value === "object"
      ? value
      : {};

  const db = { ...source };
  const defaults = createEmptyDB();

  for (const key of Object.keys(defaults)) {
    if (!Array.isArray(db[key])) {
      db[key] = [];
    }
  }

  return db;
}

let databaseCache = createEmptyDB();
let databaseReady = false;
let saveQueue = Promise.resolve();
let lastSaveError = "";

async function initializeDatabase() {
  const { data, error } = await supabase
    .from("app_data")
    .select("data")
    .eq("id", "main")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load Supabase data: ${error.message}`
    );
  }

  if (data?.data) {
    databaseCache = normalizeDatabase(data.data);
  } else {
    databaseCache = createEmptyDB();

    const { error: createError } = await supabase
      .from("app_data")
      .upsert(
        {
          id: "main",
          data: databaseCache,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (createError) {
      throw new Error(
        `Failed to create Supabase data: ${createError.message}`
      );
    }
  }

  const recoveryResult = recoverMissingUsersFromApprovedPayments(databaseCache);

  if (recoveryResult.created > 0 || recoveryResult.linked > 0) {
    const { error: recoverySaveError } = await supabase
      .from("app_data")
      .upsert(
        {
          id: "main",
          data: databaseCache,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (recoverySaveError) {
      throw new Error(
        `Failed to save recovered users: ${recoverySaveError.message}`
      );
    }
  }

  databaseReady = true;
  lastSaveError = "";

  console.log("Approved-payment user recovery", recoveryResult);

  console.log("Supabase database loaded", {
    plans: databaseCache.plans.length,
    users: databaseCache.users.length,
    devices: databaseCache.devices.length,
    rooms: databaseCache.rooms.length,
    payments: databaseCache.payments.length,
    supportRequests:
      databaseCache.supportRequests.length,
    supportMessages:
      databaseCache.supportMessages.length,
  });
}

function readDB() {
  if (!databaseReady) {
    throw new Error("Database is not ready");
  }

  return databaseCache;
}

function writeDB(db) {
  databaseCache = normalizeDatabase(db);

  const snapshot = JSON.parse(
    JSON.stringify(databaseCache)
  );

  saveQueue = saveQueue.then(async () => {
    const { error } = await supabase
      .from("app_data")
      .upsert(
        {
          id: "main",
          data: snapshot,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (error) {
      lastSaveError = error.message;
      console.error(
        "Supabase save failed:",
        error.message
      );
      return;
    }

    lastSaveError = "";
  });

  return saveQueue;
}

async function flushDatabaseWrites() {
  await saveQueue;
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

function getDeviceType(deviceName = "") {
  const value = String(deviceName || "").toLowerCase();
  if (/iphone|ipad|ios/.test(value)) return "iOS";
  if (/android/.test(value)) return "Android";
  if (/macintosh|mac os|macbook/.test(value)) return "Mac";
  if (/windows/.test(value)) return "Windows";
  if (/linux/.test(value)) return "Linux";
  return "Other";
}

function isRecentlyOnline(value, minutes = 5) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= minutes * 60 * 1000;
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
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarMonthsToDate(months, purchaseDate = new Date()) {
  const { year, month, day } = getDubaiDateParts(purchaseDate);
  const totalMonths = year * 12 + (month - 1) + Number(months || 1);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const targetMonth = targetMonthIndex + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));

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
  const expiryDate = String(user.subscriptionEnd || "").slice(0, 10);

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

  if (user.subscriptionStatus === "expired" || !user.subscriptionStatus) {
    user.subscriptionStatus = "active";
    user.updatedAt = new Date().toISOString();
    return true;
  }

  return false;
}


function paymentRecoveryDisabled(payment) {
  return (
    payment?.recoveryDisabled === true ||
    Boolean(payment?.userDeletedAt)
  );
}

function getPaymentSubscriptionEnd(payment) {
  const explicitEnd = String(
    payment?.subscriptionEnd || payment?.expiryDate || ""
  ).slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(explicitEnd)) {
    return explicitEnd;
  }

  const approvedDate = new Date(
    payment?.approvedAt || payment?.updatedAt || payment?.createdAt || Date.now()
  );

  const safeApprovedDate = Number.isNaN(approvedDate.getTime())
    ? new Date()
    : approvedDate;

  return addSubscriptionDate(
    payment?.planName || "Monthly Plan",
    safeApprovedDate
  );
}

function recoverMissingUsersFromApprovedPayments(db, options = {}) {
  const force = options.force === true;
  const now = new Date().toISOString();
  let created = 0;
  let linked = 0;
  let skipped = 0;
  const recoveredUsers = [];

  for (const payment of db.payments) {
    if (
      normalize(payment?.status) !== "approved" ||
      !String(payment?.accessKey || "").trim()
    ) {
      continue;
    }

    if (!force && paymentRecoveryDisabled(payment)) {
      skipped += 1;
      continue;
    }

    const accessKey = String(payment.accessKey).trim();
    const existingUser = db.users.find(
      (user) =>
        (payment.userId &&
          String(user.id) === String(payment.userId)) ||
        sameValue(user.accessKey, accessKey)
    );

    if (existingUser) {
      let paymentChanged = false;

      if (payment.userId !== existingUser.id) {
        payment.userId = existingUser.id;
        paymentChanged = true;
      }

      const currentUserAccessKey = String(
        existingUser.accessKey || ""
      ).trim();

      if (
        currentUserAccessKey &&
        !sameValue(payment.accessKey, currentUserAccessKey)
      ) {
        payment.accessKey = currentUserAccessKey;
        paymentChanged = true;
      }

      if (paymentChanged) {
        payment.updatedAt = now;
        linked += 1;
      }

      continue;
    }

    const subscriptionStart = String(
      payment.subscriptionStart || payment.approvedAt || payment.createdAt || getTodayDate()
    ).slice(0, 10);

    const user = {
      id: payment.userId || makeId("user"),
      username: payment.username || `User ${accessKey}`,
      contact: payment.contact || "",
      accessKey,
      deviceLimit: Number(payment.deviceLimit || 2) || 2,
      subscriptionStart,
      subscriptionEnd: getPaymentSubscriptionEnd(payment),
      subscriptionStatus: "active",
      status: "active",
      recoveredFromPayment: true,
      recoveredAt: now,
      createdAt: payment.approvedAt || payment.createdAt || now,
      updatedAt: now,
    };

    updateSubscriptionStatus(user);
    db.users.push(user);

    payment.userId = user.id;
    payment.recoveryDisabled = false;
    payment.userDeletedAt = "";
    payment.updatedAt = now;

    recoveredUsers.push(user);
    created += 1;
  }

  return {
    created,
    linked,
    skipped,
    recoveredUsers,
  };
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
        new Error(
          `CORS blocked for origin: ${origin}`
        )
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
const streamApiSecret =
  process.env.STREAM_API_SECRET;

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

  const response =
    await serverClient.deleteChannels(cids);

  if (response?.task_id) {
    await serverClient.getTask(
      response.task_id
    );
  }

  return uniqueIds;
}

app.get("/", (_req, res) => {
  res.send("Backend is running");
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    database: databaseReady ? "connected" : "loading",
    pendingSaveError: lastSaveError || null,
    time: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| STREAM TOKEN AND PRIVATE ROOM CREATION
|--------------------------------------------------------------------------
*/

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

    if (
      !providedUserId.startsWith(
        expectedPrefix
      )
    ) {
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
        !normalize(
          error?.message
        ).includes("already exists")
      ) {
        throw error;
      }
    }

    try {
      await channel.addMembers([
        providedUserId,
      ]);
    } catch (error) {
      console.warn(
        "Add member warning:",
        error.message
      );
    }

    const token =
      serverClient.createToken(
        providedUserId
      );

    return res.json({
      token,
      userId: providedUserId,
      name: displayName,
      room: privateRoomId,
      accessKey: finalAccessKey,
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

/*
|--------------------------------------------------------------------------
| LOGIN AND DEVICE LIMIT
|--------------------------------------------------------------------------
*/

app.post("/api/login", (req, res) => {
  const {
    username = "",
    name = "",
    accessKey = "",
    deviceId = "",
    deviceName = "",
    country = "Unknown",
    timezone = "",
    platform = "",
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

  const canonicalKey = String(
    user.accessKey
  );

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

  const existingDevice =
    activeDevices.find(
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

    existingDevice.streamUserId = streamUserId;
    existingDevice.country = country || existingDevice.country || "Unknown";
    existingDevice.timezone = timezone || existingDevice.timezone || "";
    existingDevice.platform = platform || existingDevice.platform || "";
    existingDevice.deviceType = getDeviceType(deviceName || existingDevice.deviceName);
    user.lastLoginAt = new Date().toISOString();
    user.lastActivityAt = user.lastLoginAt;
    user.country = country || user.country || "Unknown";
    user.timezone = timezone || user.timezone || "";

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

  if (
    activeDevices.length >= deviceLimit
  ) {
    return res.status(403).json({
      error:
        `Device limit reached. This Access Key ` +
        `is allowed on ${deviceLimit} devices only.`,
    });
  }

  db.devices.push({
    id: makeId("device"),
    userId: user.id,
    accessKey: canonicalKey,
    deviceId,
    deviceName: deviceName || "Unknown Device",
    deviceType: getDeviceType(deviceName),
    country: country || "Unknown",
    timezone: timezone || "",
    platform: platform || "",
    streamUserId,
    status: "active",
    firstLoginAt:
      new Date().toISOString(),
    lastLoginAt:
      new Date().toISOString(),
  });

  user.lastLoginAt = new Date().toISOString();
  user.lastActivityAt = user.lastLoginAt;
  user.country = country || user.country || "Unknown";
  user.timezone = timezone || user.timezone || "";

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

/*
|--------------------------------------------------------------------------
| USER ROOM LIST
|--------------------------------------------------------------------------
*/

app.get(
  "/api/rooms/:accessKey",
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

/*
|--------------------------------------------------------------------------
| DELETE ONE ROOM
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| DELETE MULTIPLE SELECTED ROOMS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| DELETE ALL ROOMS FOR ONE ACCESS KEY
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| SUBSCRIPTION PLANS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| PAYMENT SETTINGS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| SUBMIT PAYMENT REQUEST
|--------------------------------------------------------------------------
*/

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
  const linkedUser = db.users.find(
    (user) =>
      String(user.id) ===
        String(existingPayment.userId || "") ||
      sameValue(
        user.accessKey,
        existingPayment.accessKey
      )
  );

  if (
    existingPayment.status === "approved" &&
    !linkedUser
  ) {
    existingPayment.status = "revoked";
    existingPayment.accessKey = "";
    existingPayment.userId = "";
    existingPayment.revokedAt =
      new Date().toISOString();
    existingPayment.updatedAt =
      new Date().toISOString();
    existingPayment.adminComment =
      "Access Key revoked because the linked user no longer exists";

    writeDB(db);
  }

  if (existingPayment.status === "revoked") {
    return res.status(409).json({
      error:
        "This UPI reference was already used and its Access Key was revoked. Please enter a new valid payment reference.",
      status: "revoked",
      paymentId: existingPayment.id,
      accessKey: "",
    });
  }

  return res.json({
    success: true,
    alreadySubmitted: true,
    status: existingPayment.status,
    paymentId: existingPayment.id,
    accessKey:
      existingPayment.status === "approved"
        ? existingPayment.accessKey || ""
        : "",
    payment: {
      ...existingPayment,
      accessKey:
        existingPayment.status === "approved"
          ? existingPayment.accessKey || ""
          : "",
    },
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

/*
|--------------------------------------------------------------------------
| PAYMENT STATUS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/subscribe/status/:paymentId",
  (req, res) => {
    const db = readDB();

    const payment = db.payments.find(
      (item) =>
        String(item.id) ===
        String(req.params.paymentId)
    );

    if (!payment) {
      return res.status(404).json({
        error: "Payment request not found",
      });
    }

    const linkedUser = db.users.find(
      (user) =>
        String(user.id) ===
          String(payment.userId || "") ||
        sameValue(
          user.accessKey,
          payment.accessKey
        )
    );

    if (
      payment.status === "approved" &&
      !linkedUser
    ) {
      return res.json({
        ...payment,
        status: "revoked",
        accessKey: "",
        userId: "",
        message:
          "This Access Key is no longer active.",
      });
    }

    return res.json({
      ...payment,
      accessKey:
        payment.status === "approved"
          ? payment.accessKey
          : "",
    });
  }
);

/*
|--------------------------------------------------------------------------
| PUBLIC SUPPORT
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ROOM SUPPORT
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| GENERAL SUPPORT REQUEST
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| GET SUPPORT FOR ACCESS KEY
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| USER SUPPORT REPLY
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN CREATE USER
|--------------------------------------------------------------------------
*/

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

      subscriptionEnd,
      subscriptionStatus:
        "active",

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

app.post("/api/activity", (req, res) => {
  const { accessKey, deviceId, country = "Unknown", timezone = "", platform = "" } = req.body || {};
  if (!accessKey || !deviceId) {
    return res.status(400).json({ error: "Access Key and device ID are required" });
  }

  const db = readDB();
  const user = db.users.find((item) => sameValue(item.accessKey, accessKey));
  if (!user) return res.status(404).json({ error: "User not found" });

  const now = new Date().toISOString();
  user.lastActivityAt = now;
  user.lastLoginAt = user.lastLoginAt || now;
  user.country = country || user.country || "Unknown";
  user.timezone = timezone || user.timezone || "";

  const device = db.devices.find(
    (item) => sameValue(item.accessKey, accessKey) && item.deviceId === deviceId
  );
  if (device) {
    device.lastActivityAt = now;
    device.lastLoginAt = now;
    device.country = country || device.country || "Unknown";
    device.timezone = timezone || device.timezone || "";
    device.platform = platform || device.platform || "";
    device.deviceType = getDeviceType(device.deviceName);
  }

  writeDB(db);
  return res.json({ success: true, lastActivityAt: now });
});

app.get("/api/admin/dashboard", (req, res) => {
  if (!checkAdminPin(req, res)) return;
  const db = readDB();
  let changed = false;
  for (const user of db.users) {
    if (updateSubscriptionStatus(user)) changed = true;
  }
  if (changed) writeDB(db);

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const countryCounts = {};
  const deviceCounts = {};

  for (const user of db.users) {
    const country = String(user.country || "Unknown").trim() || "Unknown";
    countryCounts[country] = (countryCounts[country] || 0) + 1;
  }
  for (const device of db.devices.filter((item) => item.status === "active")) {
    const type = device.deviceType || getDeviceType(device.deviceName);
    deviceCounts[type] = (deviceCounts[type] || 0) + 1;
  }

  const totalUsers = db.users.length;
  const totalDevices = db.devices.filter((item) => item.status === "active").length;
  const topCountries = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count, percentage: totalUsers ? Math.round((count / totalUsers) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  const deviceSummary = Object.entries(deviceCounts)
    .map(([type, count]) => ({ type, count, percentage: totalDevices ? Math.round((count / totalDevices) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  return res.json({
    totalUsers,
    onlineNow: db.users.filter((user) => isRecentlyOnline(user.lastActivityAt || user.lastLoginAt)).length,
    joinedThisWeek: db.users.filter((user) => new Date(user.createdAt || 0).getTime() >= weekAgo).length,
    countries: Object.keys(countryCounts).filter((country) => country !== "Unknown").length,
    activeUsers: db.users.filter((user) => user.status === "active" && user.subscriptionStatus !== "expired").length,
    expiredUsers: db.users.filter((user) => user.subscriptionStatus === "expired").length,
    pendingPayments: db.payments.filter((payment) => payment.status === "pending").length,
    openSupport: db.supportRequests.filter((ticket) => !["closed", "solved", "archived"].includes(ticket.status)).length,
    closedSupport: db.supportRequests.filter((ticket) => ["closed", "solved", "archived"].includes(ticket.status)).length,
    totalRooms: db.rooms.length,
    totalDevices,
    topCountries,
    deviceSummary,
  });
});

app.get("/api/admin/devices", (req, res) => {
  if (!checkAdminPin(req, res)) return;
  const db = readDB();
  const devices = db.devices
  .filter((device) => device.status !== "removed")
  .map((device) => {
    const user = db.users.find((item) => item.id === device.userId || sameValue(item.accessKey, device.accessKey));
    return {
      ...device,
      username: user?.username || "Unknown",
      deviceType: device.deviceType || getDeviceType(device.deviceName),
      country: device.country || user?.country || "Unknown",
      isOnline: isRecentlyOnline(device.lastActivityAt || device.lastLoginAt),
    };
  });
  return res.json(devices);
});
app.post("/api/admin/devices/delete-all", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const adminDeleteKey = String(
    req.body?.adminDeleteKey ||
    req.headers["x-admin-key"] ||
    ""
  );

  if (
    adminDeleteKey !==
    String(process.env.ADMIN_DELETE_KEY || "")
  ) {
    return res.status(403).json({
      error: "Invalid admin delete key",
    });
  }

  const db = readDB();
  const deleted = db.devices.length;

  db.devices = [];

  writeDB(db);

  return res.json({
    success: true,
    deleted,
    message: `Deleted all ${deleted} devices`,
  });
});
app.delete("/api/admin/devices/:deviceId", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();

  const deviceIndex = db.devices.findIndex(
    (item) => String(item.id) === String(req.params.deviceId)
  );

  if (deviceIndex === -1) {
    return res.status(404).json({
      error: "Device not found",
    });
  }

  const [deletedDevice] = db.devices.splice(deviceIndex, 1);

  writeDB(db);

  return res.json({
    success: true,
    deletedDevice,
    message: "Device deleted permanently",
  });
});
app.post("/api/admin/devices/delete-multiple", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const { deviceIds } = req.body || {};

  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return res.status(400).json({
      error: "Select at least one device",
    });
  }

  const db = readDB();
  const selectedIds = new Set(deviceIds.map(String));

  const deletedDevices = db.devices.filter((device) =>
    selectedIds.has(String(device.id))
  );

  db.devices = db.devices.filter(
    (device) => !selectedIds.has(String(device.id))
  );

  writeDB(db);

  return res.json({
    success: true,
    deleted: deletedDevices.length,
    deletedDevices,
    message: `${deletedDevices.length} device(s) deleted successfully`,
  });
});

/*
|--------------------------------------------------------------------------
| ADMIN USER DELETION HELPERS
|--------------------------------------------------------------------------
*/

async function deleteUsersAndRelatedData(db, userIds) {
  const selectedIds = new Set((userIds || []).map(String));

  const usersToDelete = db.users.filter((user) =>
    selectedIds.has(String(user.id))
  );

  const accessKeys = new Set(
    usersToDelete.map((user) => normalize(user.accessKey))
  );

  const roomsToDelete = db.rooms.filter((room) =>
    accessKeys.has(normalize(room.accessKey))
  );

  await deleteStreamChannels(
    roomsToDelete.map((room) => room.id)
  );

  const ticketIdsToDelete = new Set(
    db.supportRequests
      .filter((ticket) =>
        accessKeys.has(normalize(ticket.accessKey))
      )
      .map((ticket) => String(ticket.id))
  );

  const deletedDeviceCount = db.devices.filter(
    (device) => accessKeys.has(normalize(device.accessKey))
  ).length;

  for (const payment of db.payments) {
    if (accessKeys.has(normalize(payment.accessKey))) {
      payment.recoveryDisabled = true;
      payment.userDeletedAt = new Date().toISOString();
      payment.updatedAt = payment.userDeletedAt;
    }
  }

  db.users = db.users.filter(
    (user) => !selectedIds.has(String(user.id))
  );

  db.devices = db.devices.filter(
    (device) => !accessKeys.has(normalize(device.accessKey))
  );

  db.rooms = db.rooms.filter(
    (room) => !accessKeys.has(normalize(room.accessKey))
  );

  db.supportRequests = db.supportRequests.filter(
    (ticket) => !ticketIdsToDelete.has(String(ticket.id))
  );

  db.supportMessages = db.supportMessages.filter(
    (message) =>
      !ticketIdsToDelete.has(String(message.supportRequestId))
  );
  for (const payment of db.payments) {
  const deletedUser = usersToDelete.find(
    (user) =>
      String(payment.userId || "") ===
        String(user.id) ||
      sameValue(
        payment.accessKey,
        user.accessKey
      )
  );

  if (deletedUser) {
    payment.status = "revoked";
    payment.accessKey = "";
    payment.userId = "";
    payment.revokedAt =
      new Date().toISOString();
    payment.updatedAt =
      new Date().toISOString();
    payment.adminComment =
      "Access Key revoked because the user was deleted";
  }
}

  return {
    usersToDelete,
    deletedDeviceCount,
    deletedRoomIds: roomsToDelete.map((room) => room.id),
    deletedTicketIds: [...ticketIdsToDelete],
  };
}

/*
|--------------------------------------------------------------------------
| ADMIN DELETE ONE USER
|--------------------------------------------------------------------------
*/

app.delete("/api/admin/users/:userId", async (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;

    const db = readDB();
    const user = db.users.find(
      (item) => String(item.id) === String(req.params.userId)
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = await deleteUsersAndRelatedData(db, [user.id]);
    writeDB(db);

    return res.json({
      success: true,
      deleted: 1,
      deletedUser: user,
      deletedRooms: result.deletedRoomIds,
      message: "User and related devices, rooms and support data deleted",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to delete user",
      details: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN DELETE MULTIPLE USERS
|--------------------------------------------------------------------------
*/

app.post("/api/admin/users/delete-multiple", async (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;

    const { userIds } = req.body || {};

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: "Select at least one user",
      });
    }

    const db = readDB();
    const result = await deleteUsersAndRelatedData(db, userIds);

    if (result.usersToDelete.length === 0) {
      return res.status(404).json({ error: "No matching users found" });
    }

    writeDB(db);

    return res.json({
      success: true,
      deleted: result.usersToDelete.length,
      deletedUsers: result.usersToDelete,
      deletedRooms: result.deletedRoomIds,
      message: `${result.usersToDelete.length} user(s) deleted successfully`,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to delete users",
      details: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN DELETE ALL USERS
|--------------------------------------------------------------------------
*/

app.post("/api/admin/users/delete-all", async (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;

    const suppliedDeleteKey = String(
      req.headers["x-admin-key"] ||
        req.body?.adminDeleteKey ||
        req.body?.deleteKey ||
        ""
    ).trim();

    const requiredDeleteKey = String(
      process.env.ADMIN_DELETE_KEY || ""
    ).trim();

    if (!requiredDeleteKey) {
      return res.status(500).json({
        error: "ADMIN_DELETE_KEY is not configured",
      });
    }

    if (suppliedDeleteKey !== requiredDeleteKey) {
      return res.status(403).json({
        error: "Invalid admin delete key",
      });
    }

    const db = readDB();
    const allUserIds = db.users.map((user) => user.id);
    const result = await deleteUsersAndRelatedData(db, allUserIds);
    writeDB(db);

    return res.json({
      success: true,
      deleted: result.usersToDelete.length,
      deletedRooms: result.deletedRoomIds,
      message: `Deleted all ${result.usersToDelete.length} users and related data`,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to delete all users",
      details: error.message,
    });
  }
});

app.delete("/api/admin/rooms/:roomId", async (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;
    const db = readDB();
    const room = db.rooms.find((item) => String(item.id) === String(req.params.roomId));
    if (!room) return res.status(404).json({ error: "Room not found" });
    await deleteStreamChannels([room.id]);
    db.rooms = db.rooms.filter((item) => String(item.id) !== String(room.id));
    writeDB(db);
    return res.json({ success: true, deleted: 1, deletedRoom: room.id });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete room", details: error.message });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN GET USERS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/admin/users",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    let statusChanged = false;

    for (const user of db.users) {
      if (updateSubscriptionStatus(user)) {
        statusChanged = true;
      }
    }

    if (statusChanged) {
      writeDB(db);
    }

    const users = db.users.map(
      (user) => ({
        ...user,

        isOnline: isRecentlyOnline(user.lastActivityAt || user.lastLoginAt),
        joinedThisWeek: new Date(user.createdAt || 0).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000,
        country: user.country || "Unknown",
        lastLoginAt: user.lastLoginAt || "",

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

/*
|--------------------------------------------------------------------------
| ADMIN UPDATE USER
|--------------------------------------------------------------------------
*/

app.patch(
  "/api/admin/users/:userId",
  (req, res) => {
    if (!checkAdminPin(req, res)) {
      return;
    }

    const db = readDB();

    const user = db.users.find(
      (item) =>
        String(item.id) ===
        String(req.params.userId)
    );

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const oldAccessKey = String(
      user.accessKey || ""
    ).trim();

    const requestedAccessKey =
      req.body.accessKey !== undefined
        ? String(req.body.accessKey || "").trim()
        : oldAccessKey;

    if (!requestedAccessKey) {
      return res.status(400).json({
        error: "Access Key cannot be empty",
      });
    }

    if (!/^\d{5}$/.test(requestedAccessKey)) {
      return res.status(400).json({
        error: "Access Key must contain exactly 5 digits",
      });
    }

    const duplicateUser = db.users.find(
      (item) =>
        String(item.id) !== String(user.id) &&
        sameValue(item.accessKey, requestedAccessKey)
    );

    if (duplicateUser) {
      return res.status(409).json({
        error:
          "This Access Key is already being used by another user",
      });
    }

    const accessKeyChanged = !sameValue(
      oldAccessKey,
      requestedAccessKey
    );

    const now = new Date().toISOString();

    if (req.body.username !== undefined) {
      user.username = String(
        req.body.username || ""
      ).trim();
    }

    if (req.body.contact !== undefined) {
      user.contact = String(
        req.body.contact || ""
      ).trim();
    }

    if (req.body.subscriptionEnd !== undefined) {
      user.subscriptionEnd = String(
        req.body.subscriptionEnd || ""
      ).slice(0, 10);
    }

    if (req.body.status !== undefined) {
      user.status = req.body.status;
    }

    if (
      req.body.subscriptionStatus !==
      undefined
    ) {
      user.subscriptionStatus =
        req.body.subscriptionStatus;
    }

    if (
      req.body.deviceLimit !==
      undefined
    ) {
      const deviceLimit = Number(
        req.body.deviceLimit
      );

      if (
        !Number.isInteger(deviceLimit) ||
        deviceLimit < 1
      ) {
        return res.status(400).json({
          error:
            "Device limit must be a whole number of at least 1",
        });
      }

      user.deviceLimit = deviceLimit;
    }

    if (accessKeyChanged) {
      user.accessKey = requestedAccessKey;

      for (const payment of db.payments) {
        if (
          String(payment.userId || "") ===
            String(user.id) ||
          sameValue(
            payment.accessKey,
            oldAccessKey
          )
        ) {
          payment.userId = user.id;
          payment.accessKey = requestedAccessKey;
          payment.recoveryDisabled = false;
          payment.userDeletedAt = "";
          payment.updatedAt = now;
        }
      }

      for (const device of db.devices) {
        if (
          String(device.userId || "") ===
            String(user.id) ||
          sameValue(
            device.accessKey,
            oldAccessKey
          )
        ) {
          device.userId = user.id;
          device.accessKey = requestedAccessKey;
          device.updatedAt = now;
        }
      }

      for (const room of db.rooms) {
        if (
          sameValue(
            room.accessKey,
            oldAccessKey
          )
        ) {
          room.accessKey = requestedAccessKey;
          room.updatedAt = now;
        }
      }

      for (const ticket of db.supportRequests) {
        if (
          String(ticket.userId || "") ===
            String(user.id) ||
          sameValue(
            ticket.accessKey,
            oldAccessKey
          )
        ) {
          ticket.userId =
            ticket.userId || user.id;
          ticket.accessKey = requestedAccessKey;
          ticket.updatedAt = now;
        }
      }

      for (const message of db.supportMessages) {
        if (
          sameValue(
            message.accessKey,
            oldAccessKey
          )
        ) {
          message.accessKey = requestedAccessKey;
        }
      }

      for (const login of db.loginHistory) {
        if (
          String(login.userId || "") ===
            String(user.id) ||
          sameValue(
            login.accessKey,
            oldAccessKey
          )
        ) {
          login.userId = user.id;
          login.accessKey = requestedAccessKey;
        }
      }
    }

    user.updatedAt = now;

    writeDB(db);

    return res.json({
      success: true,
      user,
      accessKeyChanged,
      previousAccessKey:
        accessKeyChanged
          ? oldAccessKey
          : "",
      message: accessKeyChanged
        ? "User and linked records updated with the new Access Key"
        : "User updated successfully",
    });
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN UPDATE DEVICE LIMIT
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN EXTEND SUBSCRIPTION
|--------------------------------------------------------------------------
*/

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

    const requestedDays = Number(req.body?.days || 30);
    const monthsToAdd =
      requestedDays >= 365
        ? 12
        : requestedDays >= 90
        ? 3
        : 1;

    const today = getTodayDate();
    const currentEnd = String(user.subscriptionEnd || "").slice(0, 10);
    const baseDateString = currentEnd > today ? currentEnd : today;
    const [baseYear, baseMonth, baseDay] = baseDateString
      .split("-")
      .map(Number);
    const baseDate = new Date(
      Date.UTC(baseYear, baseMonth - 1, baseDay, 12, 0, 0)
    );

    user.subscriptionEnd = addCalendarMonthsToDate(
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

/*
|--------------------------------------------------------------------------
| ADMIN UPDATE PLAN
|--------------------------------------------------------------------------
*/

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
      plan.active = Boolean(
        req.body.active
      );
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

/*
|--------------------------------------------------------------------------
| ADMIN GET PAYMENTS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN APPROVE PAYMENT
|--------------------------------------------------------------------------
*/

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
    payment.subscriptionStart = user.subscriptionStart;
    payment.subscriptionEnd = user.subscriptionEnd;
    payment.deviceLimit = user.deviceLimit;
    payment.recoveryDisabled = false;
    payment.userDeletedAt = "";

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

/*
|--------------------------------------------------------------------------
| ADMIN REJECT PAYMENT
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN GET ROOMS
|--------------------------------------------------------------------------
*/

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

        return {
          ...room,

          username:
            user?.username ||
            room.ownerName ||
            "Unknown",

          subscriptionEnd:
            user?.subscriptionEnd ||
            "",

          userStatus:
            user?.status ||
            "unknown",
        };
      }
    );

    return res.json(result);
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN DELETE ALL ROOMS FOR ACCESS KEY
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN GET SUPPORT
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN SUPPORT REPLY
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| ADMIN UPDATE SUPPORT STATUS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| BACKWARDS-COMPATIBLE USER DELETE-MANY ROUTE
|--------------------------------------------------------------------------
*/

app.post(
  "/api/rooms/delete-many",
  async (req, res) => {
    try {
      const { accessKey, roomIds } = req.body || {};

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
      const auth = getActiveUserByAccessKey(db, accessKey);

      if (auth.error) {
        return res.status(auth.status).json({
          error: auth.error,
        });
      }

      const requestedIds = new Set(roomIds.map(String));
      const ownedRooms = db.rooms.filter(
        (room) =>
          requestedIds.has(String(room.id)) &&
          sameValue(room.accessKey, auth.user.accessKey)
      );

      if (ownedRooms.length === 0) {
        return res.status(404).json({
          error:
            "No matching rooms found for this Access Key",
        });
      }

      const ownedIds = ownedRooms.map((room) => room.id);
      await deleteStreamChannels(ownedIds);

      const deletedSet = new Set(ownedIds);
      db.rooms = db.rooms.filter(
        (room) =>
          !(
            deletedSet.has(room.id) &&
            sameValue(room.accessKey, auth.user.accessKey)
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
      console.error("Delete many rooms error:", error);
      return res.status(500).json({
        error: "Failed to delete rooms",
        details: error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN DELETE MULTIPLE ROOMS
|--------------------------------------------------------------------------
*/

app.post(
  "/api/admin/rooms/delete-multiple",
  async (req, res) => {
    try {
      if (!checkAdminPin(req, res)) return;

      const { roomIds } = req.body || {};

      if (!Array.isArray(roomIds) || roomIds.length === 0) {
        return res.status(400).json({
          error: "At least one room ID is required",
        });
      }

      const db = readDB();
      const requestedIds = new Set(roomIds.map(String));
      const rooms = db.rooms.filter((room) =>
        requestedIds.has(String(room.id))
      );
      const ids = rooms.map((room) => room.id);

      if (ids.length === 0) {
        return res.status(404).json({
          error: "No matching rooms found",
        });
      }

      await deleteStreamChannels(ids);
      const deletedSet = new Set(ids.map(String));
      db.rooms = db.rooms.filter(
        (room) => !deletedSet.has(String(room.id))
      );
      writeDB(db);

      return res.json({
        success: true,
        deleted: ids.length,
        deletedRooms: ids,
      });
    } catch (error) {
      console.error("Admin delete multiple rooms error:", error);
      return res.status(500).json({
        error: "Failed to delete rooms",
        details: error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN DELETE EVERY ROOM FOR EVERY ACCESS KEY
|--------------------------------------------------------------------------
*/

app.post(
  "/api/admin/rooms/delete-all",
  async (req, res) => {
    try {
      if (!checkAdminPin(req, res)) return;

      const suppliedDeleteKey = String(
        req.headers["x-admin-key"] ||
          req.body?.adminDeleteKey ||
          req.body?.deleteKey ||
          ""
      ).trim();

      const requiredDeleteKey = String(
        process.env.ADMIN_DELETE_KEY || ""
      ).trim();

      if (!requiredDeleteKey) {
        return res.status(500).json({
          error: "ADMIN_DELETE_KEY is not configured",
        });
      }

      if (suppliedDeleteKey !== requiredDeleteKey) {
        return res.status(403).json({
          error: "Invalid admin delete key",
        });
      }

      const db = readDB();
      const roomIds = db.rooms.map((room) => room.id);

      await deleteStreamChannels(roomIds);
      db.rooms = [];
      writeDB(db);

      return res.json({
        success: true,
        deleted: roomIds.length,
        deletedRooms: roomIds,
        message:
          `Deleted ${roomIds.length} room(s) across all Access Keys`,
      });
    } catch (error) {
      console.error("Admin delete all rooms error:", error);
      return res.status(500).json({
        error: "Failed to delete all rooms",
        details: error.message,
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| ADMIN SYSTEM MAINTENANCE
|--------------------------------------------------------------------------
*/

function getAdminDeleteKey(req) {
  return String(
    req.headers["x-admin-key"] ||
      req.body?.adminDeleteKey ||
      req.body?.deleteKey ||
      ""
  ).trim();
}

function checkAdminDeleteKey(req, res) {
  const required = String(process.env.ADMIN_DELETE_KEY || "").trim();

  if (!required) {
    res.status(500).json({
      error: "ADMIN_DELETE_KEY is not configured",
    });
    return false;
  }

  if (getAdminDeleteKey(req) !== required) {
    res.status(403).json({
      error: "Invalid admin delete key",
    });
    return false;
  }

  return true;
}

app.post("/api/admin/maintenance/sync-users", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();
  const result = recoverMissingUsersFromApprovedPayments(db, {
    force: req.body?.force === true,
  });

  if (result.created > 0 || result.linked > 0) {
    writeDB(db);
  }

  return res.json({
    success: true,
    ...result,
    totalUsers: db.users.length,
    message: `${result.created} missing user(s) restored`,
  });
});

app.post("/api/admin/maintenance/cleanup-orphans", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();
  const validUserIds = new Set(db.users.map((user) => String(user.id)));
  const validAccessKeys = new Set(
    db.users.map((user) => normalize(user.accessKey)).filter(Boolean)
  );
  const validTicketIds = new Set(
    db.supportRequests.map((ticket) => String(ticket.id))
  );

  const beforeDevices = db.devices.length;
  const beforeRooms = db.rooms.length;
  const beforeMessages = db.supportMessages.length;

  db.devices = db.devices.filter(
    (device) =>
      validUserIds.has(String(device.userId)) ||
      validAccessKeys.has(normalize(device.accessKey))
  );

  db.rooms = db.rooms.filter((room) =>
    validAccessKeys.has(normalize(room.accessKey))
  );

  db.supportMessages = db.supportMessages.filter((message) =>
    validTicketIds.has(String(message.supportRequestId))
  );

  writeDB(db);

  return res.json({
    success: true,
    removedDevices: beforeDevices - db.devices.length,
    removedRooms: beforeRooms - db.rooms.length,
    removedSupportMessages: beforeMessages - db.supportMessages.length,
  });
});

app.get("/api/admin/maintenance/backup", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();
  const filename = `myroom-backup-${getTodayDate()}.json`;

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"${filename}\"`
  );
  return res.send(JSON.stringify(db, null, 2));
});

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

app.get("/api/admin/maintenance/export/:type", (req, res) => {
  if (!checkAdminPin(req, res)) return;

  const db = readDB();
  const type = String(req.params.type || "").toLowerCase();
  const allowed = {
    users: db.users,
    devices: db.devices,
    rooms: db.rooms,
    payments: db.payments,
    support: db.supportRequests,
  };
  const rows = allowed[type];

  if (!rows) {
    return res.status(400).json({ error: "Invalid export type" });
  }

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const csv = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const value = row?.[column];
          return csvEscape(
            value && typeof value === "object"
              ? JSON.stringify(value)
              : value
          );
        })
        .join(",")
    ),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"myroom-${type}-${getTodayDate()}.csv\"`
  );
  return res.send(csv);
});

app.post("/api/admin/payments/delete-all", (req, res) => {
  if (!checkAdminPin(req, res)) return;
  if (!checkAdminDeleteKey(req, res)) return;

  const db = readDB();
  const deleted = db.payments.length;
  db.payments = [];
  writeDB(db);

  return res.json({ success: true, deleted });
});

app.post("/api/admin/support/delete-all", (req, res) => {
  if (!checkAdminPin(req, res)) return;
  if (!checkAdminDeleteKey(req, res)) return;

  const db = readDB();
  const deletedRequests = db.supportRequests.length;
  const deletedMessages = db.supportMessages.length;
  db.supportRequests = [];
  db.supportMessages = [];
  writeDB(db);

  return res.json({
    success: true,
    deletedRequests,
    deletedMessages,
  });
});

app.post("/api/admin/system/reset", async (req, res) => {
  try {
    if (!checkAdminPin(req, res)) return;
    if (!checkAdminDeleteKey(req, res)) return;

    const confirmation = String(req.body?.confirmation || "").trim();
    if (confirmation !== "RESET MYROOM") {
      return res.status(400).json({
        error: 'Type "RESET MYROOM" to confirm',
      });
    }

    const db = readDB();
    const roomIds = db.rooms.map((room) => room.id);
    await deleteStreamChannels(roomIds);

    const preservedPlans = [...db.plans];
    databaseCache = {
      ...createEmptyDB(),
      plans: preservedPlans,
    };
    writeDB(databaseCache);

    return res.json({
      success: true,
      deletedRooms: roomIds.length,
      message: "System reset completed. Subscription plans were preserved.",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to reset system",
      details: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| SOCKET.IO CALLS AND SIGNALING
|--------------------------------------------------------------------------
*/

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

async function startServer() {
  try {
    await initializeDatabase();

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
  } catch (error) {
    console.error(
      "Server startup failed:",
      error?.message || error
    );
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} received. Saving database...`);

  try {
    await flushDatabaseWrites();
  } catch (error) {
    console.error(
      "Failed to flush database writes:",
      error?.message || error
    );
  }

  httpServer.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer();