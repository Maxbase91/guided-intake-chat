/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// /api/admin: the admin page's endpoint. Reads and saves the draft configuration, publishes it as a new version,
// loads an earlier version back into the draft, and shows the change log and the decision log.
//
// Protected by ADMIN_CODE (header x-admin-code). Without ADMIN_CODE the endpoint is closed. Wrong codes are delayed
// and counted per IP in the database: after 5 within 15 minutes that IP is locked out for the rest of the window.
// A draft may be saved with problems (work in progress); it is published only when it is valid and every rule passes
// its own test cases, checked here with the same engine the page runs.
const { adminOk, sleep, WRONG_CODE_DELAY_MS, limitFrom, clientIp, overLimit, tooMany, jsonBody, fail } = require("./_lib/http");
const { getStore, forgetPublished, LOCK_WINDOW_MIN } = require("./_lib/store");
const { validateConfig, configFrom } = require("./_lib/seed");
const { sanitize, text } = require("./_lib/validate");
const Engine = require("../engine.js");

const MAX_BYTES = 3 * 1024 * 1024, MAX_FAILURES = 5;   // a draft with the reference data is a few hundred KB
const actorOf = (b) => text(b && b.actor, 60) || "admin";

async function state(store) {
  const draft = await store.getDraft();
  return { draft: draft.doc, revision: draft.revision, base_version: draft.base_version, published_version: draft.published_version, dirty: draft.dirty,
    updated_at: draft.updated_at, updated_by: draft.updated_by, problems: validateConfig(configFrom(draft.doc, 0, "draft")),
    versions: await store.listVersions(20), store: store.kind,
    ops: Object.fromEntries(Object.entries(Engine.OPS).map(([k, o]) => [k, { label: o.label, types: o.types, value: o.value }])) };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!["GET", "POST"].includes(req.method)) return fail(res, 405, "Method not allowed", "method_not_allowed");
  if (!process.env.ADMIN_CODE) return fail(res, 503, "The admin page is not set up: ADMIN_CODE is missing.", "admin_closed");
  const wait = overLimit("admin", req, limitFrom("ADMIN_LIMIT_PER_MIN", 120));
  if (wait) return tooMany(res, wait);
  const store = getStore(), ip = clientIp(req);
  try {
    if ((await store.recentFailures(ip)) >= MAX_FAILURES) return fail(res, 429, `Too many wrong codes. Try again in ${LOCK_WINDOW_MIN} minutes.`, "locked_out");
    if (!adminOk(req.headers["x-admin-code"])) {
      await store.recordFailure(ip);
      await sleep(WRONG_CODE_DELAY_MS);
      return fail(res, 401, "Wrong admin code.", "admin_code");
    }

    if (req.method === "GET") {
      const q = req.query || {};
      if (q.view === "audit") return res.status(200).json({ audit: await store.listAudit(200) });
      if (q.view === "decisions") return res.status(200).json({ decisions: await store.listDecisions(200), counts: await store.decisionCounts() });
      if (q.view === "version") { const v = await store.getVersion(parseInt(q.v, 10)); return v ? res.status(200).json(v) : fail(res, 404, "That version does not exist.", "not_found"); }
      return res.status(200).json(await state(store));
    }

    const b = jsonBody(req, MAX_BYTES);
    if (!b) return fail(res, 400, "The request is missing, not JSON, or too large.", "invalid_request");
    const actor = actorOf(b), revision = b.revision;
    if (!Number.isInteger(revision)) return fail(res, 400, "The draft revision is missing.", "invalid_request");

    if (b.action === "save") {
      const doc = sanitize(b.doc);
      if (!doc) return fail(res, 400, "That is not a configuration.", "invalid_request");
      const saved = await store.saveDraft(doc, revision, actor);
      return res.status(200).json({ ...saved, ...(await state(store)) });
    }
    if (b.action === "publish") {
      const draft = await store.getDraft();
      if (draft.revision !== revision) return fail(res, 409, "The draft was changed by someone else. Reload and try again.", "conflict");
      if (!draft.dirty) return fail(res, 400, "There is nothing to publish: the draft is the published version.", "nothing_to_publish");
      const problems = validateConfig(configFrom(draft.doc, 0, "draft"));
      if (problems.length) return res.status(422).json({ error: "The draft has problems and was not published.", code: "invalid_configuration", problems });
      const published = await store.publish(revision, actor, text(b.note, 300));
      forgetPublished();
      return res.status(200).json({ ...published, ...(await state(store)) });
    }
    if (b.action === "discard" || b.action === "restore") {
      const version = b.action === "restore" ? b.version : null;
      if (b.action === "restore" && !Number.isInteger(version)) return fail(res, 400, "Which version?", "invalid_request");
      await store.loadIntoDraft(version, revision, actor);
      return res.status(200).json(await state(store));
    }
    return fail(res, 400, "Unknown action.", "invalid_request");
  } catch (e) {
    if (e.code === "conflict") return fail(res, 409, e.message, "conflict");
    if (e.code === "not_found") return fail(res, 404, e.message, "not_found");
    if (e.code === "not_seeded") return fail(res, 503, "The database has no configuration yet. Run the seed first.", "not_seeded");
    console.error("admin:", e.code || "", e.message);
    return fail(res, 503, "The admin service is not available.", "admin_unavailable");
  }
};
