/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// Shared by the functions in api/: access code, admin code, per-IP rate limit, request body.
// Files in a folder that starts with an underscore are not served as functions.
const crypto = require("crypto");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (x) => crypto.createHash("sha256").update(String(x || "")).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));   // constant time; hashing first makes the lengths equal
// the page's access code: no ACCESS_CODE means open
const codeOk = (c) => !process.env.ACCESS_CODE || same(c, process.env.ACCESS_CODE);
// the admin code: no ADMIN_CODE means closed
const adminOk = (c) => !!process.env.ADMIN_CODE && same(c, process.env.ADMIN_CODE);
const WRONG_CODE_DELAY_MS = 700;        // slows down guessing on every endpoint

// per-IP limit, fixed one-minute windows, in the warm instance's memory (lost on cold start and not shared between instances,
// which is enough for a demo). x-real-ip / x-forwarded-for are set by Vercel itself, not by the caller.
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map();                 // "bucket:ip" -> { n, start }
const limitFrom = (name, dflt) => { const v = parseInt(process.env[name], 10); return Number.isFinite(v) && v >= 0 ? v : dflt; };
const clientIp = (req) => String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "unknown").trim();
// seconds to wait when this request is over the limit, else 0
function overLimit(bucket, req, max) {
  if (!max) return 0;
  const now = Date.now(), key = `${bucket}:${clientIp(req)}`;
  if (hits.size > 10000) for (const [k, h] of hits) if (now - h.start >= RATE_WINDOW_MS) hits.delete(k);
  let h = hits.get(key);
  if (!h || now - h.start >= RATE_WINDOW_MS) { h = { n: 0, start: now }; hits.set(key, h); }
  h.n++;
  return h.n > max ? Math.max(1, Math.ceil((h.start + RATE_WINDOW_MS - now) / 1000)) : 0;
}
function tooMany(res, waitS) {
  res.setHeader("Retry-After", String(waitS));
  return res.status(429).json({ error: "Too many requests. Please wait a moment and try again.", code: "rate_limited", quota: false, retryAfter: waitS });
}

// the JSON body, or null when it is missing, not an object, or larger than maxBytes
function jsonBody(req, maxBytes) {
  let b = req.body;
  if (typeof b === "string") { if (b.length > maxBytes) return null; try { b = JSON.parse(b); } catch { return null; } }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  return JSON.stringify(b).length > maxBytes ? null : b;
}
const fail = (res, status, error, code) => res.status(status).json({ error, code });

module.exports = { sleep, codeOk, adminOk, WRONG_CODE_DELAY_MS, limitFrom, clientIp, overLimit, tooMany, jsonBody, fail };
