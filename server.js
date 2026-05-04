// ============================================================
// InSkouter v3.1 — Backend with MongoDB (Permanent Storage)
// ============================================================
// Data persists forever. Server restart = no data loss.
// ============================================================

const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());

// ---- CONFIG ----
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = "inskouter";
const PORT = process.env.PORT || 10000;

// ---- DB ----
let db, scoutsCol, visitsCol;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    scoutsCol = db.collection("scouts");
    visitsCol = db.collection("visits");

    // Indexes for fast queries
    await scoutsCol.createIndex({ scoutCode: 1 }, { unique: true });
    await visitsCol.createIndex({ scoutCode: 1, platform: 1, handle: 1 });
    await visitsCol.createIndex({ scoutCode: 1, timestamp: -1 });

    console.log("✅ MongoDB connected — data is now PERMANENT");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("Set MONGODB_URI environment variable in Render!");
    process.exit(1);
  }
}

// ============================================================
// SCOUT ENDPOINTS
// ============================================================

app.post("/api/scouts", async (req, res) => {
  const { scoutName, createdBy } = req.body;
  if (!scoutName || !createdBy) return res.status(400).json({ error: "Missing fields" });

  const prefix = scoutName.replace(/\s+/g, "").toUpperCase().slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const scoutCode = `${prefix}-${suffix}`;

  await scoutsCol.insertOne({
    scoutCode,
    name: scoutName,
    createdBy,
    createdAt: Date.now(),
    members: [createdBy],
  });

  res.json({ scoutCode, scoutName, success: true });
});

app.get("/api/scouts/:scoutCode", async (req, res) => {
  const scout = await scoutsCol.findOne({ scoutCode: req.params.scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });

  res.json({
    scoutCode: scout.scoutCode,
    name: scout.name,
    createdBy: scout.createdBy,
    createdAt: scout.createdAt,
    members: scout.members,
    memberCount: scout.members.length,
  });
});

app.post("/api/scouts/:scoutCode/join", async (req, res) => {
  const { userName } = req.body;
  if (!userName) return res.status(400).json({ error: "Missing userName" });

  const scout = await scoutsCol.findOne({ scoutCode: req.params.scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });

  // Add member if not already there
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

// ============================================================
// VISIT & COLLISION DETECTION
// ============================================================

app.post("/api/visit", async (req, res) => {
  const { scoutCode, userName, platform, handle, url } = req.body;
  if (!scoutCode || !userName || !platform || !handle) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const scout = await scoutsCol.findOne({ scoutCode });
  if (!scout) return res.status(404).json({ error: "Scout not found" });

  // Add user as member if not already
  await scoutsCol.updateOne(
    { scoutCode },
    { $addToSet: { members: userName } }
  );

  const handleLower = handle.toLowerCase();
  const existing = await visitsCol.findOne({
    scoutCode,
    platform,
    handle: handleLower,
  });

  const now = Date.now();

  // COLLISION CHECK — works even if Person A scouted MONTHS ago!
  if (existing && existing.userName !== userName) {
    return res.json({
      collision: true,
      existingUser: existing.userName,
      timestamp: existing.timestamp,
      scoutName: scout.name,
    });
  }

  // Store/update visit (only if new or same user)
  if (!existing) {
    await visitsCol.insertOne({
      scoutCode,
      userName,
      platform,
      handle: handleLower,
      url,
      scoutName: scout.name,
      timestamp: now,
    });
  }

  return res.json({ collision: false });
});

// ============================================================
// ACTIVITY (recent first)
// ============================================================

app.get("/api/activity/:scoutCode", async (req, res) => {
  const activity = await visitsCol
    .find({ scoutCode: req.params.scoutCode })
    .sort({ timestamp: -1 })
    .limit(100)
    .toArray();

  res.json(activity);
});

// ============================================================
// HEALTH
// ============================================================

app.get("/api/health", async (req, res) => {
  const scoutCount = await scoutsCol.countDocuments();
  const visitCount = await visitsCol.countDocuments();
  res.json({
    status: "ok",
    storage: "MongoDB (permanent)",
    scouts: scoutCount,
    visits: visitCount,
  });
});

// ============================================================
// START
// ============================================================

connectDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔍 InSkouter v3.1 (MongoDB) running on port ${PORT}`);
  });
});
