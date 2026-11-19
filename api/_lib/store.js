/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// Where the configuration and the decision log live. Two stores with the same interface:
//   Postgres (DATABASE_URL set): Neon in production, any Postgres locally.
//   Memory (no DATABASE_URL): the seed, for tests and for running locally without a database. Nothing is kept.
//
// The configuration has a working draft and published versions. The admin page edits the draft; publishing copies it
// into a new version, which is never changed afterwards. The page reads the latest version.
const { PARTS, SEED, bodyOf, canon, checksumOf, configFrom } = require("./seed");

const DECISION_CAP = 2000, LOCK_WINDOW_MIN = 15;
const conflict = () => Object.assign(new Error("The draft was changed by someone else. Reload and try again."), { code: "conflict" });
// key order must not count: a document read back from a jsonb column has its keys in another order
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const KEY = { categories: "id", rules: "id", divisions: "id", next_steps: "key", entities: "id", domains: "id", examples: "text", l4: "code", suppliers: "name", contracts: "id", catalogue: "id" };
const keyOf = (part, item) => item[KEY[part] || "key"];

// what changed between two documents, one entry per item: [{ part, item, before, after }]
function diff(before, after) {
  const out = [];
  for (const part of PARTS) {
    const a = new Map((before[part] || []).map((x) => [keyOf(part, x), x])), b = new Map((after[part] || []).map((x) => [keyOf(part, x), x]));
    for (const k of new Set([...a.keys(), ...b.keys()])) if (!same(a.get(k), b.get(k))) out.push({ part, item: String(k), before: a.get(k) ?? null, after: b.get(k) ?? null });
  }
  // more than 25 changes in one part (an upload) are one line: how many entries were added, changed and removed
  const many = new Set(Object.entries(out.reduce((n, c) => ({ ...n, [c.part]: (n[c.part] || 0) + 1 }), {})).filter(([, n]) => n > 25).map(([p]) => p));
  return [...out.filter((c) => !many.has(c.part)), ...[...many].map((part) => {
    const of = out.filter((c) => c.part === part), count = (f) => of.filter(f).length;
    return { part, item: `${of.length} entries`, before: null, after: { added: count((c) => !c.before), changed: count((c) => c.before && c.after), removed: count((c) => !c.after) } };
  })];
}

function memoryStore() {
  const versions = [], decisions = [], audit = [], attempts = [];
  const now = () => new Date().toISOString();
  let draft = { doc: structuredClone(bodyOf(SEED)), base_version: 0, revision: 1, updated_at: now(), updated_by: "seed" };
  const latest = () => versions[versions.length - 1] || { version: 0, doc: structuredClone(bodyOf(SEED)), published_at: null, actor: "seed", note: "Built-in configuration (db/seed)", checksum: checksumOf(SEED) };
  const log = (e) => { audit.push({ id: audit.length + 1, at: now(), ...e }); };
  return {
    kind: "memory",
    // the seed itself until something is published, so the page sees exactly its built-in defaults
    async getPublished() { const v = latest(); return configFrom(v.doc, v.version, v.version ? "database" : "builtin"); },
    async getDraft() { const v = latest(); return { ...structuredClone(draft), published_version: v.version, dirty: !same(draft.doc, v.doc) }; },
    async saveDraft(doc, revision, actor) {
      if (revision !== draft.revision) throw conflict();
      const changes = diff(draft.doc, doc);
      changes.forEach((c) => log({ actor, action: "save", ...c, version: null }));
      draft = { ...draft, doc: structuredClone(doc), revision: draft.revision + 1, updated_at: now(), updated_by: actor };
      return { revision: draft.revision, changes: changes.length };
    },
    async publish(revision, actor, note) {
      if (revision !== draft.revision) throw conflict();
      const version = latest().version + 1;
      versions.push({ version, published_at: now(), actor, note, checksum: checksumOf(draft.doc), doc: structuredClone(draft.doc) });
      draft = { ...draft, base_version: version, revision: draft.revision + 1 };
      log({ actor, action: "publish", part: null, item: null, before: null, after: null, version });
      return { version, revision: draft.revision };
    },
    // the draft becomes a copy of a published version (the latest when none is named); it is published like any other change
    async loadIntoDraft(version, revision, actor) {
      if (revision !== draft.revision) throw conflict();
      const v = version == null ? latest() : version === 0 ? { version: 0, doc: structuredClone(bodyOf(SEED)) } : versions.find((x) => x.version === version);
      if (!v) throw Object.assign(new Error("That version does not exist."), { code: "not_found" });
      draft = { doc: structuredClone(v.doc), base_version: v.version, revision: draft.revision + 1, updated_at: now(), updated_by: actor };
      log({ actor, action: version == null ? "discard" : "restore", part: null, item: null, before: null, after: null, version: v.version });
      return { revision: draft.revision };
    },
    async listVersions(limit = 20) { return versions.slice(-limit).reverse().map(({ doc, ...v }) => v); },
    async getVersion(version) { const v = versions.find((x) => x.version === version); return v ? structuredClone(v) : null; },
    async listAudit(limit = 100) { return audit.slice(-limit).reverse(); },
    async saveDecisions(batch) {
      let stored = 0;
      for (const d of batch.decisions) {
        if (decisions.some((x) => x.conversation_id === batch.conversation_id && x.seq === d.seq)) continue;
        decisions.push({ ...d, conversation_id: batch.conversation_id, config_version: batch.config_version, config_source: batch.config_source, config_checksum: batch.config_checksum, received_at: now() });
        stored++;
      }
      if (decisions.length > DECISION_CAP) decisions.splice(0, decisions.length - DECISION_CAP);
      return stored;
    },
    async listDecisions(limit = 100) { return decisions.slice(-limit).reverse(); },
    async decisionCounts() {
      const m = new Map();
      decisions.forEach((d) => { const k = `${d.rule}|${d.outcome}`; m.set(k, (m.get(k) || 0) + 1); });
      return [...m].map(([k, n]) => ({ rule: k.split("|")[0], outcome: k.split("|")[1], n })).sort((a, b) => a.rule.localeCompare(b.rule) || b.n - a.n);
    },
    async recordFailure(ip) { attempts.push({ ip, at: Date.now() }); },
    async recentFailures(ip) { const since = Date.now() - LOCK_WINDOW_MIN * 60000; return attempts.filter((a) => a.ip === ip && a.at >= since).length; },
    async close() {},
  };
}

function postgresStore(url) {
  const { Pool } = require("pg");
  // a function instance serves one request at a time: a small pool, released quickly
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
  pool.on("error", () => {});   // an idle client dropped by the server must not crash the function
  const tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query("begin"); const out = await fn(c); await c.query("commit"); return out; }
    catch (e) { await c.query("rollback").catch(() => {}); throw e; }
    finally { c.release(); }
  };
  const latest = async (c) => (await c.query("select version, doc from config_versions order by version desc limit 1")).rows[0];
  // locks the draft row and checks the revision the caller started from
  const lockDraft = async (c, revision) => {
    const d = (await c.query("select doc, base_version, revision from config_draft where id = 1 for update")).rows[0];
    if (!d) throw Object.assign(new Error("No configuration is published yet"), { code: "not_seeded" });
    if (d.revision !== revision) throw conflict();
    return d;
  };
  return {
    kind: "postgres",
    pool,
    async getPublished() {
      const v = await latest(pool);
      if (!v) throw Object.assign(new Error("No configuration is published yet"), { code: "not_seeded" });
      return configFrom(v.doc, v.version, "database");
    },
    async getDraft() {
      const d = (await pool.query("select doc, base_version, revision, updated_at, updated_by from config_draft where id = 1")).rows[0], v = await latest(pool);
      if (!d || !v) throw Object.assign(new Error("No configuration is published yet"), { code: "not_seeded" });
      return { ...d, doc: bodyOf(d.doc), published_version: v.version, dirty: checksumOf(d.doc) !== checksumOf(v.doc) };
    },
    async saveDraft(doc, revision, actor) {
      return tx(async (c) => {
        const d = await lockDraft(c, revision), changes = diff(bodyOf(d.doc), bodyOf(doc));
        for (const ch of changes) await c.query("insert into audit_log (actor, action, part, item, before, after) values ($1, 'save', $2, $3, $4, $5)", [actor, ch.part, ch.item, JSON.stringify(ch.before), JSON.stringify(ch.after)]);
        const r = await c.query("update config_draft set doc = $1, revision = revision + 1, updated_at = now(), updated_by = $2 where id = 1 returning revision", [JSON.stringify(bodyOf(doc)), actor]);
        return { revision: r.rows[0].revision, changes: changes.length };
      });
    },
    async publish(revision, actor, note) {
      return tx(async (c) => {
        const d = await lockDraft(c, revision);
        await c.query("lock table config_versions in exclusive mode");
        const version = ((await latest(c)) || { version: 0 }).version + 1;
        await c.query("insert into config_versions (version, actor, note, checksum, doc) values ($1, $2, $3, $4, $5)", [version, actor, note, checksumOf(d.doc), JSON.stringify(d.doc)]);
        const r = await c.query("update config_draft set base_version = $1, revision = revision + 1 where id = 1 returning revision", [version]);
        await c.query("insert into audit_log (actor, action, version) values ($1, 'publish', $2)", [actor, version]);
        return { version, revision: r.rows[0].revision };
      });
    },
    async loadIntoDraft(version, revision, actor) {
      return tx(async (c) => {
        await lockDraft(c, revision);
        const v = version == null ? await latest(c) : (await c.query("select version, doc from config_versions where version = $1", [version])).rows[0];
        if (!v) throw Object.assign(new Error("That version does not exist."), { code: "not_found" });
        const r = await c.query("update config_draft set doc = $1, base_version = $2, revision = revision + 1, updated_at = now(), updated_by = $3 where id = 1 returning revision", [JSON.stringify(v.doc), v.version, actor]);
        await c.query("insert into audit_log (actor, action, version) values ($1, $2, $3)", [actor, version == null ? "discard" : "restore", v.version]);
        return { revision: r.rows[0].revision };
      });
    },
    async listVersions(limit = 20) { return (await pool.query("select version, published_at, actor, note, checksum from config_versions order by version desc limit $1", [limit])).rows; },
    async getVersion(version) { return (await pool.query("select version, published_at, actor, note, checksum, doc from config_versions where version = $1", [version])).rows[0] || null; },
    async listAudit(limit = 100) { return (await pool.query("select id, at, actor, action, part, item, before, after, version from audit_log order by id desc limit $1", [limit])).rows; },
    async saveDecisions(batch) {
      if (!batch.decisions.length) return 0;
      const cols = 9, values = [], rows = batch.decisions.map((d, i) => {
        values.push(batch.conversation_id, d.seq, d.rule, d.row, d.outcome, batch.config_version, batch.config_source, batch.config_checksum, JSON.stringify(d.facts));
        return `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(",")})`;
      });
      const r = await pool.query(
        `insert into decisions (conversation_id, seq, rule_id, rule_row, outcome, config_version, config_source, config_checksum, facts)
         values ${rows.join(",")} on conflict (conversation_id, seq) do nothing`, values);
      return r.rowCount;
    },
    async listDecisions(limit = 100) {
      const r = await pool.query(
        `select conversation_id, seq, rule_id as rule, rule_row as row, outcome, config_version, config_source, config_checksum, facts, received_at
         from decisions order by id desc limit $1`, [Math.min(Math.max(1, limit | 0), 500)]);
      return r.rows;
    },
    async decisionCounts() { return (await pool.query("select rule_id as rule, outcome, count(*)::int as n from decisions group by 1, 2 order by 1, 3 desc")).rows; },
    async recordFailure(ip) { await pool.query("insert into admin_attempts (ip) values ($1)", [ip]); },
    async recentFailures(ip) { return (await pool.query(`select count(*)::int as n from admin_attempts where ip = $1 and at > now() - interval '${LOCK_WINDOW_MIN} minutes'`, [ip])).rows[0].n; },
    async close() { await pool.end(); },
  };
}

let current = null;
// one store per function instance
function getStore() {
  if (!current) current = process.env.DATABASE_URL ? postgresStore(process.env.DATABASE_URL) : memoryStore();
  return current;
}

// the published configuration, read at most once a minute per warm instance; a publish on this instance shows at once,
// on other instances within a minute
const CACHE_MS = 60 * 1000;
let cache = null;
async function publishedCached(fresh) {
  if (fresh || !cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), cfg: await getStore().getPublished() };
  return cache.cfg;
}
const forgetPublished = () => { cache = null; };

module.exports = { getStore, memoryStore, postgresStore, publishedCached, forgetPublished, diff, LOCK_WINDOW_MIN };
