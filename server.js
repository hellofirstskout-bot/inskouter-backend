// ============================================================
// InSkouter v3.0 — BACKEND with Scout Code System
// ============================================================

const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

// ---- DATA ----
const scouts = new Map();      // scoutCode → { name, createdBy, createdAt, members: Set }
const visits = new Map();       // scoutCode:platform:handle → { userName, timestamp, ... }
const EXPIRY_MS = 24 * 60 * 60 * 1000;

// Cleanup every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of visits) {
    if (now - data.timestamp > EXPIRY_MS) visits.delete(key);
  }
}, 60_000);

// ============================================================
// SCOUT ENDPOINTS
// ============================================================

// POST /api/scouts — Create a new scout
app.post("/api/scouts", (req, res) => {
  const { scoutName, createdBy } = req.body;
  if (!scoutName || !createdBy) return res.status(400).json({ error: "Missing fields" });

  // Generate unique code: SCOUTNAME-XXXX
  const prefix = scoutName.replace(/\s+/g, "").toUpperCase().slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const scoutCode = `${prefix}-${suffix}`;

  scouts.set(scoutCode, {
    name: scoutName,
    createdBy,
    createdAt: Date.now(),
    members: new Set([createdBy]),
  });

  res.json({ scoutCode, scoutName, success: true });
});

// GET /api/scouts/:scoutCode — Get scout info
app.get("/api/scouts/:scoutCode", (req, res) => {
  const scout = scouts.get(req.params.scoutCode);
  if (!scout) return res.status(404).json({ error: "Scout not found" });

  res.json({
    scoutCode: req.params.scoutCode,
    name: scout.name,
    createdBy: scout.createdBy,
    createdAt: scout.createdAt,
    members: Array.from(scout.members),
    memberCount: scout.members.size,
  });
});

// POST /api/scouts/:scoutCode/join — Join a scout
app.post("/api/scouts/:scoutCode/join", (req, res) => {
  const { userName } = req.body;
  if (!userName) return res.status(400).json({ error: "Missing userName" });

  const scout = scouts.get(req.params.scoutCode);
  if (!scout) return res.status(404).json({ error: "Scout not found" });

  scout.members.add(userName);
  res.json({
    scoutCode: req.params.scoutCode,
    scoutName: scout.name,
    members: Array.from(scout.members),
    joined: true,
  });
});

// ============================================================
// VISIT & COLLISION
// ============================================================

app.post("/api/visit", (req, res) => {
  const { scoutCode, userName, platform, handle, url } = req.body;
  if (!scoutCode || !userName || !platform || !handle) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const scout = scouts.get(scoutCode);
  if (!scout) return res.status(404).json({ error: "Scout not found" });

  // Add member if not exists
  scout.members.add(userName);

  const key = `${scoutCode}:${platform}:${handle.toLowerCase()}`;
  const existing = visits.get(key);
  const now = Date.now();

  // Check collision
  if (existing && existing.userName !== userName && now - existing.timestamp < EXPIRY_MS) {
    return res.json({
      collision: true,
      existingUser: existing.userName,
      timestamp: existing.timestamp,
      scoutName: scout.name,
    });
  }

  // Store visit
  visits.set(key, {
    userName, platform, handle: handle.toLowerCase(),
    url, scoutCode, scoutName: scout.name, timestamp: now,
  });

  return res.json({ collision: false });
});

// ============================================================
// ACTIVITY
// ============================================================

app.get("/api/activity/:scoutCode", (req, res) => {
  const prefix = `${req.params.scoutCode}:`;
  const activity = [];
  for (const [key, data] of visits) {
    if (key.startsWith(prefix)) activity.push(data);
  }
  activity.sort((a, b) => b.timestamp - a.timestamp);
  res.json(activity.slice(0, 100));
});

// ============================================================
// HEALTH
// ============================================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    scouts: scouts.size,
    visits: visits.size,
    totalMembers: Array.from(scouts.values()).reduce((sum, s) => sum + s.members.size, 0),
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`🔍 InSkouter v3.0 on port ${PORT}`));
