require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET environment variable. Set it before starting the server.");
  process.exit(1);
}

const PORT = process.env.PORT || 3001;

function makeReferralCode(username) {
  const clean = username.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "USER";
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${clean}-${rand}`;
}

function toPublicUser(row) {
  return {
    username: row.username,
    coins: row.coins,
    adsWatched: row.ads_watched,
    videosWatched: row.videos_watched,
    boostsSent: row.boosts_sent,
    referralCode: row.referral_code,
    referredBy: row.referred_by,
    referralCount: row.referral_count,
    hasOnboarded: !!row.has_onboarded,
  };
}

function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

function getUser(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

app.post("/api/signup", async (req, res) => {
  const { username, password, referralCode } = req.body || {};
  const uname = (username || "").trim().toLowerCase();

  if (!uname || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters." });
  }
  if (getUser(uname)) {
    return res.status(409).json({ error: "That username is taken." });
  }

  let referrer = null;
  if (referralCode) {
    referrer = db.prepare("SELECT * FROM users WHERE referral_code = ?").get(referralCode.trim().toUpperCase());
    if (!referrer) {
      return res.status(400).json({ error: "That referral code doesn't match any account." });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const referralCodeForUser = makeReferralCode(uname);
  const startingCoins = referrer ? 75 : 50;

  const insert = db.prepare(`
    INSERT INTO users (username, password_hash, coins, referral_code, referred_by)
    VALUES (?, ?, ?, ?, ?)
  `);
  insert.run(uname, passwordHash, startingCoins, referralCodeForUser, referrer ? referrer.username : null);

  if (referrer) {
    db.prepare("UPDATE users SET coins = coins + 25, referral_count = referral_count + 1 WHERE username = ?")
      .run(referrer.username);
  }

  const user = getUser(uname);
  res.json({ token: signToken(uname), user: toPublicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const uname = (username || "").trim().toLowerCase();
  const user = getUser(uname);
  if (!user) return res.status(404).json({ error: "No account with that username." });

  const valid = await bcrypt.compare(password || "", user.password_hash);
  if (!valid) return res.status(401).json({ error: "Wrong password." });

  res.json({ token: signToken(uname), user: toPublicUser(user) });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = getUser(req.username);
  if (!user) return res.status(404).json({ error: "Account no longer exists." });
  res.json({ user: toPublicUser(user) });
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = getUser(req.username);
  const valid = await bcrypt.compare(currentPassword || "", user.password_hash);
  if (!valid) return res.status(401).json({ error: "Current password is wrong." });
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters." });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hash, req.username);
  res.json({ ok: true });
});

app.delete("/api/account", requireAuth, (req, res) => {
  db.prepare("DELETE FROM users WHERE username = ?").run(req.username);
  res.json({ ok: true });
});

app.post("/api/onboarded", requireAuth, (req, res) => {
  db.prepare("UPDATE users SET has_onboarded = 1 WHERE username = ?").run(req.username);
  res.json({ ok: true });
});

app.post("/api/earn", requireAuth, (req, res) => {
  const { amount, kind } = req.body || {};
  const column = kind === "videosWatched" ? "videos_watched" : "ads_watched";
  if (![5, 10].includes(amount)) return res.status(400).json({ error: "Invalid amount." });

  db.prepare(`UPDATE users SET coins = coins + ?, ${column} = ${column} + 1 WHERE username = ?`)
    .run(amount, req.username);
  db.prepare("INSERT INTO activity (user_id, text) VALUES ((SELECT id FROM users WHERE username = ?), ?)")
    .run(req.username, `You earned ${amount} coins`);

  res.json({ user: toPublicUser(getUser(req.username)) });
});

app.post("/api/boost", requireAuth, (req, res) => {
  const { link, amount, cost } = req.body || {};
  const user = getUser(req.username);
  if (!link || !amount || !cost) return res.status(400).json({ error: "Missing boost details." });
  if (user.coins < cost) return res.status(400).json({ error: "Not enough coins." });

  db.prepare("UPDATE users SET coins = coins - ?, boosts_sent = boosts_sent + 1 WHERE username = ?")
    .run(cost, req.username);
  db.prepare("INSERT INTO boosts (user_id, link, amount, cost) VALUES ((SELECT id FROM users WHERE username = ?), ?, ?, ?)")
    .run(req.username, link, amount, cost);
  db.prepare("INSERT INTO activity (user_id, text) VALUES ((SELECT id FROM users WHERE username = ?), ?)")
    .run(req.username, `You spent ${cost} coins → ${amount} queued for ${link}`);

  res.json({ user: toPublicUser(getUser(req.username)) });
});

app.get("/api/activity", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT text, created_at FROM activity WHERE user_id = (SELECT id FROM users WHERE username = ?) ORDER BY id DESC LIMIT 30"
  ).all(req.username);
  res.json({ activity: rows });
});

app.get("/api/leaderboard", (req, res) => {
  const rows = db.prepare("SELECT username, coins FROM users ORDER BY coins DESC LIMIT 20").all();
  res.json({ leaderboard: rows });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Boostly API listening on port ${PORT}`);
});
