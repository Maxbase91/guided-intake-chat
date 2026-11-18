/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// GET /api/config: the published configuration (thresholds, channels, category cards, facts, rules) as one document.
// Needs the access code when one is set. The page falls back to its last copy, then to its built-in defaults, when
// this fails, so an error here never stops a conversation.
const { codeOk, sleep, WRONG_CODE_DELAY_MS, limitFrom, overLimit, tooMany, fail } = require("./_lib/http");
const { publishedCached } = require("./_lib/store");
const { REF_PARTS } = require("./_lib/seed");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return fail(res, 405, "Method not allowed", "method_not_allowed");
  const wait = overLimit("config", req, limitFrom("CONFIG_LIMIT_PER_MIN", 300));
  if (wait) return tooMany(res, wait);
  if (!codeOk(req.headers["x-access-code"])) { await sleep(WRONG_CODE_DELAY_MS); return fail(res, 401, "Access code required", "access_code"); }
  try {
    const cfg = await publishedCached();
    // the reference data is large: left out when the page already has the same (it sends the checksum of what it has)
    if (req.headers["x-ref-checksum"] && req.headers["x-ref-checksum"] === cfg.ref_checksum) return res.status(200).json(Object.fromEntries(Object.entries(cfg).filter(([k]) => !REF_PARTS.includes(k))));
    return res.status(200).json(cfg);
  } catch (e) {
    console.error("config:", e.code || "", e.message);
    return fail(res, 503, "The configuration could not be loaded.", e.code === "not_seeded" ? "not_seeded" : "config_unavailable");
  }
};
