// ============================================================
// InSkouter by FirstSkout — Backend API Server
// ============================================================
//   npm install express cors
//   node server.js
// ============================================================

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Key: "teamId:campaignId:platform:handle"
const visits = new Map();
const EXPIRY_MS = 24 * 60 * 60 * 1000;

// Cleanup expired
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of visits) {
    if (now - data.timestamp > EXPIRY_MS) visits.delete(key);
  }
}, 60_000);

// POST /api/visit — Register a profile visit (campaign-scoped)
app.post("/api/visit", (req, res) => {
  const { teamId, campaignId, campaignName, userName, platform, handle, url } = req.body;

  if (!teamId || !campaignId || !userName || !platform || !handle) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const key = `${teamId}:${campaignId}:${platform}:${handle.toLowerCase()}`;
  const existing = visits.get(key);
  const now = Date.now();

  if (existing && existing.userName !== userName && now - existing.timestamp < EXPIRY_MS) {
    return res.json({
      collision: true,
      existingUser: existing.userName,
      timestamp: existing.timestamp,
      campaignName: existing.campaignName || campaignName,
    });
  }

  visits.set(key, {
    userName, platform,
    handle: handle.toLowerCase(),
    url, campaignId, campaignName,
    timestamp: now,
  });

  return res.json({ collision: false });
});

// GET /api/activity/:teamId/:campaignId — Activity for a specific campaign
app.get("/api/activity/:teamId/:campaignId", (req, res) => {
  const prefix = `${req.params.teamId}:${req.params.campaignId}:`;
  const activity = [];
  for (const [key, data] of visits) {
    if (key.startsWith(prefix)) activity.push(data);
  }
  activity.sort((a, b) => b.timestamp - a.timestamp);
  res.json(activity.slice(0, 50));
});

// GET /api/activity/:teamId — All activity for a team
app.get("/api/activity/:teamId", (req, res) => {
  const prefix = `${req.params.teamId}:`;
  const activity = [];
  for (const [key, data] of visits) {
    if (key.startsWith(prefix)) activity.push(data);
  }
  activity.sort((a, b) => b.timestamp - a.timestamp);
  res.json(activity.slice(0, 50));
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", visits: visits.size });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`🔍 InSkouter API running on port ${PORT}`));
