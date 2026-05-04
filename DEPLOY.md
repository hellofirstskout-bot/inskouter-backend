# 🔍 InSkouter Backend — Deployment Guide

## Option 1: Railway (Easiest, Free Tier)

1. Go to [railway.app](https://railway.app) → Sign up with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Push this `inskouter-backend` folder to a GitHub repo, OR:
   - Click **"Empty Project"** → **"Add Service"** → **"Empty Service"**
   - Connect your repo or drag-drop the files
4. Railway auto-detects Node.js and runs `npm start`
5. Go to **Settings** → **Networking** → **Generate Domain**
6. Copy the URL (e.g. `https://inskouter-backend-production.up.railway.app`)
7. In your extension popup → **Settings** → paste:  
   `https://inskouter-backend-production.up.railway.app/api`

## Option 2: Render (Free Tier)

1. Go to [render.com](https://render.com) → Sign up
2. Click **"New"** → **"Web Service"**
3. Connect your GitHub repo with these files
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **Deploy**
6. Copy the URL → paste in extension settings + `/api`

## Option 3: Run Locally (Testing Only)

```bash
cd inskouter-backend
npm install
npm start
# → Running on http://localhost:3001
```
Then in extension settings, enter: `http://localhost:3001/api`

---

## After Deploying

1. Copy your backend URL
2. Open InSkouter extension → ⚙️ Settings tab
3. Paste in **Backend API URL** field:  
   `https://your-app-name.up.railway.app/api`
4. Click **Save**
5. **Every teammate** must enter the same URL in their extension

## Test It

Visit this in your browser to check if it's running:
```
https://your-backend-url/api/health
```
You should see: `{"status":"ok","visits":0}`

---

## Important Notes

- The free tier works fine for small teams (5-15 people)
- Data resets if the server restarts (in-memory storage)
- For production: upgrade to Redis for persistent storage
- The server auto-cleans visits older than 24 hours
