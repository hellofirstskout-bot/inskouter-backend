// ============================================================
// InSkouter v3.2 — SECURE Backend
// Security: API key auth, scout passwords, rate limiting
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json({ limit: "10kb" }));

const MONGODB_URI = process.env.MONGODB_URI;
const API_KEY = process.env.API_KEY || "CHANGE_ME";
const DB_NAME = "inskouter";
const PORT = process.env.PORT || 10000;

// CORS — allow Chrome extensions
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin.startsWith("chrome-extension://")) {
      return callback(null, true);
    }
    callback(new Error("Blocked by CORS"));
  },
  methods: ["GET", "POST", "DELETE"],
}));

// Middleware: API key required
function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Middleware: rate limit (60 req/min per IP)
const rateStore = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const rec = rateStore.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60000; }
  rec.count++;
  rateStore.set(ip, rec);
  if (rec.count > 60) return res.status(429).json({ error: "Too many requests" });
  next();
}

function valid(v, max = 100) {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

app.use(rateLimit);

// ---- DATABASE ----
let scoutsCol, visitsCol;
async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI, {
      tls: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
    await client.connect();
    const db = client.db(DB_NAME);
    scoutsCol = db.collection("scouts");
    visitsCol = db.collection("visits");
    await scoutsCol.createIndex({ scoutCode: 1 }, { unique: true });
    await visitsCol.createIndex({ scoutCode: 1, platform: 1, handle: 1 });
    await visitsCol.createIndex({ scoutCode: 1, timestamp: -1 });
    console.log("✅ MongoDB connected — SECURE mode");
  } catch (err) {
    console.error("❌ MongoDB failed:", err.message);
    process.exit(1);
  }
}

// ---- PUBLIC: Health check (no sensitive data) ----
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ---- CREATE SCOUT (with password) ----
app.post("/api/scouts", requireApiKey, async (req, res) => {
  const { scoutName, createdBy, scoutPassword } = req.body;
  if (!valid(scoutName, 80) || !valid(createdBy, 60)) {
    return res.status(400).json({ error: "Invalid input" });
  }
  if (!valid(scoutPassword, 100) || scoutPassword.length < 4) {
    return res.status(400).json({ error: "Password required (min 4 chars)" });
  }

  const prefix = scoutName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8) || "SCOUT";
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const scoutCode = `${prefix}-${suffix}`;

  await scoutsCol.insertOne({
    scoutCode,
    name: scoutName,
    createdBy,
    passwordHash: hash(scoutPassword),
    createdAt: Date.now(),
    members: [createdBy],
  });

  res.json({ scoutCode, scoutName, success: true });
});

// ---- JOIN SCOUT (verify password) ----
app.post("/api/scouts/:scoutCode/join", requireApiKey, async (req, res) => {
  const { userName, scoutPassword } = req.body;
  if (!valid(userName, 60) || !valid(scoutPassword, 100)) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const scout = await scoutsCol.findOne({ scoutCode: req.params.scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });
  if (scout.passwordHash !== hash(scoutPassword)) {
    return res.status(401).json({ error: "Wrong scout password" });
  }
  await scoutsCol.updateOne(
    { scoutCode: req.params.scoutCode },
    { $addToSet: { members: userName } }
  );
  const updated = await scoutsCol.findOne({ scoutCode: req.params.scoutCode });
  res.json({
    scoutCode: req.params.scoutCode,
    scoutName: updated.name,
    members: updated.members,
    joined: true,
  });
});

// ---- GET SCOUT INFO (members only) ----
app.get("/api/scouts/:scoutCode", requireApiKey, async (req, res) => {
  const { userName } = req.query;
  if (!valid(userName, 60)) return res.status(400).json({ error: "Missing userName" });
  const scout = await scoutsCol.findOne({ scoutCode: req.params.scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });
  if (!scout.members.includes(userName)) {
    return res.status(403).json({ error: "Not a member" });
  }
  res.json({
    scoutCode: scout.scoutCode,
    name: scout.name,
    createdBy: scout.createdBy,
    createdAt: scout.createdAt,
    members: scout.members,
    memberCount: scout.members.length,
  });
});

// ---- VISIT (members only) ----
app.post("/api/visit", requireApiKey, async (req, res) => {
  const { scoutCode, userName, platform, handle, url } = req.body;
  if (!valid(scoutCode, 50) || !valid(userName, 60) ||
      !valid(platform, 30) || !valid(handle, 100)) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const scout = await scoutsCol.findOne({ scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });
  if (!scout.members.includes(userName)) {
    return res.status(403).json({ error: "Not a member" });
  }
  const handleLower = handle.toLowerCase();
  const existing = await visitsCol.findOne({ scoutCode, platform, handle: handleLower });
  const now = Date.now();
  if (existing && existing.userName !== userName) {
    return res.json({
      collision: true,
      existingUser: existing.userName,
      timestamp: existing.timestamp,
      scoutName: scout.name,
    });
  }
  if (!existing) {
    await visitsCol.insertOne({
      scoutCode, userName, platform,
      handle: handleLower,
      url: valid(url, 500) ? url : "",
      scoutName: scout.name,
      timestamp: now,
    });
  }
  res.json({ collision: false });
});

// ---- ACTIVITY (members only) ----
app.get("/api/activity/:scoutCode", requireApiKey, async (req, res) => {
  const { userName } = req.query;
  if (!valid(userName, 60)) return res.status(400).json({ error: "Missing userName" });
  const scout = await scoutsCol.findOne({ scoutCode: req.params.scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });
  if (!scout.members.includes(userName)) {
    return res.status(403).json({ error: "Not a member" });
  }
  const activity = await visitsCol
    .find({ scoutCode: req.params.scoutCode })
    .sort({ timestamp: -1 })
    .limit(100)
    .toArray();
  res.json(activity);
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

connectDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔒 InSkouter v3.2 SECURE on port ${PORT}`);
    if (API_KEY === "CHANGE_ME") {
      console.warn("⚠️  Set API_KEY env variable in Render!");
    }
  });
});
