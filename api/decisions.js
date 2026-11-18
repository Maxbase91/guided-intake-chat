/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// POST /api/decisions: the decision log of one conversation. Which rule decided what, on which configuration and from
// which facts. Only typed values are accepted (numbers, true/false, short codes): no free text, no names. The IP
// address is used for the rate limit and never stored.
const { codeOk, sleep, WRONG_CODE_DELAY_MS, limitFrom, overLimit, tooMany, jsonBody, fail } = require("./_lib/http");
const { getStore } = require("./_lib/store");
const { SEED } = require("./_lib/seed");

const MAX_BYTES = 64 * 1024, MAX_ROWS = 50;   // up to 50 rule rows, each with the typed facts of the conversation
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9][a-z0-9_-]{0,39}$/;      // an outcome, a category id, an enum value
const RULE = /^R\d{2}$/;
const SOURCES = ["database", "builtin", "cached"];
const FACTS = new Set(SEED.facts.map((f) => f.key));
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// the batch in the shape the store takes, or a reason why it is refused
function parse(b) {
  if (!b) return "The request is missing, not JSON, or too large.";
  if (!UUID.test(String(b.conversation_id || ""))) return "conversation_id must be a UUID.";
  if (!int(b.config_version, 0, 1e6) || !SOURCES.includes(b.config_source) || !/^[0-9a-f]{12}$/.test(String(b.config_checksum || ""))) return "The configuration version, source or checksum is not valid.";
  if (!Array.isArray(b.decisions) || !b.decisions.length || b.decisions.length > MAX_ROWS) return `decisions must be a list of 1 to ${MAX_ROWS} entries.`;
  const decisions = [];
  for (const d of b.decisions) {
    if (!d || typeof d !== "object" || !int(d.seq, 0, 9999) || !RULE.test(String(d.rule || "")) || !int(d.row, 0, 99) || !CODE.test(String(d.outcome || ""))) return "A decision needs seq, rule, row and outcome.";
    const facts = {};
    for (const [k, v] of Object.entries(d.facts && typeof d.facts === "object" && !Array.isArray(d.facts) ? d.facts : {})) {
      if (!FACTS.has(k)) return `Unknown fact: ${String(k).slice(0, 40)}.`;
      if (v === null || typeof v === "boolean" || (typeof v === "number" && isFinite(v)) || (typeof v === "string" && CODE.test(v))) facts[k] = v;
      else return `The value of ${k} is not a number, true or false, or a short code.`;
    }
    decisions.push({ seq: d.seq, rule: d.rule, row: d.row, outcome: d.outcome, facts });
  }
  if (new Set(decisions.map((d) => d.seq)).size !== decisions.length) return "seq must be unique within a batch.";
  return { conversation_id: b.conversation_id.toLowerCase(), config_version: b.config_version, config_source: b.config_source, config_checksum: b.config_checksum, decisions };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return fail(res, 405, "Method not allowed", "method_not_allowed");
  const wait = overLimit("decisions", req, limitFrom("DECISIONS_LIMIT_PER_MIN", 10));
  if (wait) return tooMany(res, wait);
  if (!codeOk(req.headers["x-access-code"])) { await sleep(WRONG_CODE_DELAY_MS); return fail(res, 401, "Access code required", "access_code"); }
  const batch = parse(jsonBody(req, MAX_BYTES));
  if (typeof batch === "string") return fail(res, 400, batch, "invalid_request");
  const store = getStore();
  // in production the log is only worth keeping in the database
  if (store.kind === "memory" && process.env.VERCEL) return fail(res, 503, "The decision log is not available.", "no_database");
  try {
    return res.status(200).json({ stored: await store.saveDecisions(batch) });
  } catch (e) {
    console.error("decisions:", e.code || "", e.message);
    return fail(res, 503, "The decision log could not be stored.", "store_unavailable");
  }
};
module.exports.parse = parse;
