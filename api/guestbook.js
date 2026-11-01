const { Redis } = require("@upstash/redis");
const { Ratelimit } = require("@upstash/ratelimit");

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, "60 s"),
  prefix: "guestbook:ratelimit",
});

const LIST_KEY = "guestbook:entries";
const MAX_STORED = 200;
const MAX_RETURNED = 50;
const NAME_MAX = 40;
const MESSAGE_MAX = 300;

// Basic deterrent, not a security boundary. Case-insensitive substring match.
const BLOCKLIST = [
  "nigger", "nigga", "chink", "spic", "kike", "faggot", "tranny",
  "retard", "cunt", "whore", "slut",
];

function containsBlockedWord(text) {
  const lower = text.toLowerCase();
  return BLOCKLIST.some((word) => lower.includes(word));
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      const raw = await redis.lrange(LIST_KEY, 0, MAX_RETURNED - 1);
      const entries = raw.map((item) => (typeof item === "string" ? JSON.parse(item) : item));
      res.status(200).json({ entries });
    } catch (err) {
      res.status(500).json({ error: "Something went wrong. Try again later." });
    }
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!name || !message) {
      res.status(400).json({ error: "Please fill in both fields." });
      return;
    }
    if (name.length > NAME_MAX || message.length > MESSAGE_MAX) {
      res.status(400).json({ error: "Keep it a bit shorter." });
      return;
    }
    if (containsBlockedWord(name) || containsBlockedWord(message)) {
      res.status(400).json({ error: "That entry couldn't be posted." });
      return;
    }

    try {
      const ip = getIp(req);
      const { success } = await ratelimit.limit(ip);
      if (!success) {
        res.status(429).json({ error: "You're posting too fast. Try again in a minute." });
        return;
      }

      const entry = { name, message, createdAt: new Date().toISOString() };
      await redis.lpush(LIST_KEY, JSON.stringify(entry));
      await redis.ltrim(LIST_KEY, 0, MAX_STORED - 1);

      res.status(201).json({ entry });
    } catch (err) {
      res.status(500).json({ error: "Something went wrong. Try again later." });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed." });
};
