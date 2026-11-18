/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// GET /api/config: the published configuration (thresholds, channels, category cards, facts, rules) as one document.
// Needs the access code when one is set. The page falls back to its last copy, then to its built-in defaults, when
// this fails, so an error here never stops a conversation.
const { codeOk, sleep, WRONG_CODE_DELAY_MS, limitFrom, overLimit, tooMany, fail } = require("./_lib/http");
const { publishedCached } = require("./_lib/store");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return fail(res, 405, "Method not allowed", "method_not_allowed");
  const wait = overLimit("config", req, limitFrom("CONFIG_LIMIT_PER_MIN", 300));
  if (wait) return tooMany(res, wait);
  if (!codeOk(req.headers["x-access-code"])) { await sleep(WRONG_CODE_DELAY_MS); return fail(res, 401, "Access code required", "access_code"); }
  try {
    return res.status(200).json(await publishedCached());
  } catch (e) {
    console.error("config:", e.code || "", e.message);
    return fail(res, 503, "The configuration could not be loaded.", e.code === "not_seeded" ? "not_seeded" : "config_unavailable");
  }
};
