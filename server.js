// ============================================================
// InSkouter by FirstSkout — Backend API Server v2.1
// ============================================================
// FIX: Campaigns now sync across team members
// FIX: Activity shows ALL team members' data
// ============================================================

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ---- Data Stores ----
const visits = new Map();          // "teamId:campId:platform:handle" → visit data
const teamCampaigns = new Map();   // teamId → [{ id, name, createdAt, createdBy }]
const EXPIRY_MS = 24 * 60 * 60 * 1000;

// Cleanup expired visits every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of visits) {
    if (now - data.timestamp > EXPIRY_MS) visits.delete(key);
  }
}, 60_000);

// ============================================================
// CAMPAIGN SYNC ENDPOINTS (NEW)
// ============================================================

// GET — Fetch all campaigns for a team
app.get("/api/campaigns/:teamId", (req, res) => {
  const campaigns = teamCampaigns.get(req.params.teamId) || [];
  res.json({ campaigns });
});

// POST — Create a campaign (synced to all team members)
app.post("/api/campaigns/:teamId", (req, res) => {
  const { teamId } = req.params;
  const { id, name, createdBy } = req.body;
  if (!id || !name) return res.status(400).json({ error: "Missing id or name" });

  const campaigns = teamCampaigns.get(teamId) || [];
  if (campaigns.find((c) => c.id === id)) {
    return res.json({ campaigns, duplicate: true });
  }

  campaigns.push({ id, name, createdAt: Date.now(), createdBy: createdBy || "" });
  teamCampaigns.set(teamId, campaigns);
  res.json({ campaigns, created: true });
});

// DELETE — Remove a campaign
app.delete("/api/campaigns/:teamId/:campaignId", (req, res) => {
  const { teamId, campaignId } = req.params;
  let campaigns = teamCampaigns.get(teamId) || [];
  campaigns = campaigns.filter((c) => c.id !== campaignId);
  teamCampaigns.set(teamId, campaigns);

  // Clean up visits for deleted campaign
  for (const [key] of visits) {
    if (key.startsWith(`${teamId}:${campaignId}:`)) visits.delete(key);
  }
  res.json({ campaigns, deleted: true });
});

// ============================================================
// VISIT & COLLISION DETECTION
// ============================================================

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
    userName, platform, handle: handle.toLowerCase(),
    url, campaignId, campaignName, timestamp: now,
  });
  return res.json({ collision: false });
});

// ============================================================
// ACTIVITY (shows ALL team members' visits)
// ============================================================

app.get("/api/activity/:teamId/:campaignId", (req, res) => {
  const prefix = `${req.params.teamId}:${req.params.campaignId}:`;
  const activity = [];
  for (const [key, data] of visits) {
    if (key.startsWith(prefix)) activity.push(data);
  }
  activity.sort((a, b) => b.timestamp - a.timestamp);
  res.json(activity.slice(0, 50));
});

app.get("/api/activity/:teamId", (req, res) => {
  const prefix = `${req.params.teamId}:`;
  const activity = [];
  for (const [key, data] of visits) {
    if (key.startsWith(prefix)) activity.push(data);
  }
  activity.sort((a, b) => b.timestamp - a.timestamp);
  res.json(activity.slice(0, 50));
});

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", visits: visits.size, teams: teamCampaigns.size });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`🔍 InSkouter API v2.1 running on port ${PORT}`));
