// /api/admin: closed without ADMIN_CODE, delayed and locked out on wrong codes, saves only what may be changed,
// publishes only a valid configuration, and what it publishes is what /api/config then serves.
// Runs on the memory store, and again on Postgres when TEST_DATABASE_URL is set.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ENV = ["ADMIN_CODE", "ACCESS_CODE", "DATABASE_URL", "ADMIN_LIMIT_PER_MIN", "CONFIG_LIMIT_PER_MIN"];
let saved;
const loadAll = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k]; return { admin: require(path.join(ROOT, "api", "admin.js")), config: require(path.join(ROOT, "api", "config.js")), store: require(path.join(ROOT, "api", "_lib", "store.js")) }; };
function call(handler, { method = "GET", query = {}, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); return this; } };
    Promise.resolve(handler({ method, query, headers, body }, res)).catch(reject);
  });
}
const H = { "x-admin-code": "admin-secret" };
const param = (doc, key) => doc.params.find((p) => p.key === key);

beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); ENV.forEach((k) => delete process.env[k]); });
afterEach(() => { ENV.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); });

test("without ADMIN_CODE the endpoint is closed, whatever code is sent", async () => {
  const { admin } = loadAll();
  for (const headers of [{}, { "x-admin-code": "" }, { "x-admin-code": "anything" }]) {
    const r = await call(admin, { headers });
    assert.deepEqual([r.status, r.body.code], [503, "admin_closed"]);
  }
});

test("a wrong code is refused after a delay, and five of them lock that IP out, even with the right code", async () => {
  process.env.ADMIN_CODE = "admin-secret";
  const { admin } = loadAll(), from = (ip, code) => call(admin, { headers: { "x-admin-code": code, "x-forwarded-for": ip } });
  const t0 = Date.now(), first = await from("9.9.9.9", "guess");
  assert.deepEqual([first.status, first.body.code], [401, "admin_code"]);
  assert.ok(Date.now() - t0 >= 650, "delayed");
  for (let i = 0; i < 4; i++) await from("9.9.9.9", "guess" + i);
  assert.deepEqual([(await from("9.9.9.9", "admin-secret")).body.code, (await from("8.8.8.8", "admin-secret")).status], ["locked_out", 200]);
  assert.equal((await call(admin, { method: "DELETE", headers: H })).status, 405);
});

// the whole flow on one store; url: a Postgres to run it on, else the memory store
async function editPublishFlow(url) {
  {
    if (url) process.env.DATABASE_URL = url;
    process.env.ADMIN_CODE = "admin-secret";
    const { admin, config, store } = loadAll();
    try {
      const start = (await call(admin, { headers: H })).body;
      assert.equal(start.dirty, false);
      assert.deepEqual(start.problems, []);
      const v0 = start.published_version;
      assert.equal((await call(config)).body.version, v0);

      // nothing to publish yet
      assert.equal((await call(admin, { method: "POST", headers: H, body: { action: "publish", revision: start.revision } })).body.code, "nothing_to_publish");

      // a save: one threshold changed, plus things that may not be changed or do not exist
      const doc = structuredClone(start.draft);
      param(doc, "formMin").value = 20000;
      param(doc, "leadMin").label = "<script>alert(1)</script>";               // labels are not editable
      doc.params.push({ key: "backdoor", value: 1 });                          // unknown threshold
      doc.channels.push({ key: "lowvalue", name: "Low-value purchase" });      // a fifth channel
      doc.categories[0].keywords = ["x"]; doc.categories[0].cm_mandatory = "yes";   // unknown field; not a boolean
      doc.rules.find((r) => r.id === "R11").outcomes[0].lead = "nobody";      // outcome attributes come from the seed
      doc.rules.push({ id: "R99", rows: [] });                                 // unknown rule
      doc.extra = { anything: true };
      const savedDraft = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc, revision: start.revision, actor: "  Test Admin  " } })).body;
      assert.equal(savedDraft.changes, 1);
      assert.equal(savedDraft.dirty, true);
      assert.equal(param(savedDraft.draft, "formMin").value, 20000);
      assert.equal(param(savedDraft.draft, "leadMin").label, param(start.draft, "leadMin").label);
      assert.deepEqual([savedDraft.draft.params.length, savedDraft.draft.channels.length, savedDraft.draft.rules.length, "extra" in savedDraft.draft], [start.draft.params.length, 4, 4, false]);
      assert.deepEqual([savedDraft.draft.categories[0].keywords, savedDraft.draft.categories[0].cm_mandatory], [undefined, false]);
      assert.equal(savedDraft.draft.rules.find((r) => r.id === "R11").outcomes[0].lead, "procurement");
      // the page still gets the published version
      assert.equal(param((await call(config)).body, "formMin").value, 100000);

      // a save from the old revision is a conflict
      const stale = await call(admin, { method: "POST", headers: H, body: { action: "save", doc, revision: start.revision } });
      assert.deepEqual([stale.status, stale.body.code], [409, "conflict"]);

      // a broken rule can be saved as work in progress, but not published
      const broken = structuredClone(savedDraft.draft), r11 = broken.rules.find((r) => r.id === "R11");
      r11.rows = r11.rows.slice(0, 2).concat(r11.rows.slice(-1));               // both threshold rows and the Category Manager row removed
      const wip = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc: broken, revision: savedDraft.revision } })).body;
      assert.ok(wip.problems.some((p) => /R11: test "At the upper threshold" expects lead_threshold, got division/.test(p)), wip.problems.join("\n"));
      const refused = await call(admin, { method: "POST", headers: H, body: { action: "publish", revision: wip.revision } });
      assert.deepEqual([refused.status, refused.body.code], [422, "invalid_configuration"]);
      assert.ok(refused.body.problems.length >= 1);
      assert.equal((await call(config)).body.version, v0);

      // back to the valid change, then publish
      const fixed = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc: savedDraft.draft, revision: wip.revision } })).body;
      assert.deepEqual(fixed.problems, []);
      const published = await call(admin, { method: "POST", headers: H, body: { action: "publish", revision: fixed.revision, note: "Sourcing request form from 20k", actor: "Test Admin" } });
      assert.deepEqual([published.status, published.body.version, published.body.dirty], [200, v0 + 1, false]);
      const live = (await call(config)).body;
      assert.deepEqual([live.version, live.source, param(live, "formMin").value], [v0 + 1, "database", 20000]);
      assert.deepEqual(published.body.versions[0].note, "Sourcing request form from 20k");
      assert.equal(published.body.versions[0].actor, "Test Admin");

      // the change log names who changed what
      const audit = (await call(admin, { headers: H, query: { view: "audit" } })).body.audit;
      assert.equal(audit[0].action, "publish");
      const change = audit.find((a) => a.action === "save" && a.item === "formMin");
      assert.deepEqual([change.actor, change.part, change.before.value, change.after.value], ["Test Admin", "params", 100000, 20000]);

      // an earlier version is loaded back into the draft and published as a new version
      if (v0 >= 1) {
        const restored = (await call(admin, { method: "POST", headers: H, body: { action: "restore", version: v0, revision: published.body.revision } })).body;
        assert.deepEqual([restored.dirty, param(restored.draft, "formMin").value], [true, 100000]);
        const again = (await call(admin, { method: "POST", headers: H, body: { action: "publish", revision: restored.revision, note: "Back to version " + v0 } })).body;
        assert.equal(again.version, v0 + 2);
        assert.equal(param((await call(config)).body, "formMin").value, 100000);
        assert.equal((await call(admin, { headers: H, query: { view: "version", v: String(v0 + 1) } })).body.doc.params.find((p) => p.key === "formMin").value, 20000);   // versions are never changed
      }
      assert.equal((await call(admin, { method: "POST", headers: H, body: { action: "restore", version: 999, revision: (await call(admin, { headers: H })).body.revision } })).status, 404);
      assert.equal((await call(admin, { headers: H, query: { view: "decisions" } })).status, 200);
    } finally { await store.getStore().close(); }
  }
}

test("memory store: save keeps only what may be changed; publish needs a valid draft; the page then gets the new version", () => editPublishFlow());

test("Postgres: the same flow, with an earlier version restored", { skip: !process.env.TEST_DATABASE_URL && "TEST_DATABASE_URL is not set" }, async () => {
  const url = process.env.TEST_DATABASE_URL, { Client } = require("pg");
  const { migrate } = require(path.join(ROOT, "scripts", "db-migrate.js")), { seed } = require(path.join(ROOT, "scripts", "db-seed.js"));
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("drop table if exists decisions, admin_attempts, audit_log, config_draft, config_versions, schema_migrations cascade");
  await c.end();
  await migrate(url); await seed(url);
  await editPublishFlow(url);
});

test("questions and guidance: only texts the code asks the same way can change; unknown keys and categories are dropped", () => {
  const { sanitize } = require(path.join(ROOT, "api", "_lib", "validate.js"));
  const { SEED, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const doc = structuredClone(SEED);
  const q = (d, k) => d.questions.find((x) => x.key === k);
  const g = (d, k) => d.guidance.find((x) => x.key === k);
  assert.ok("q" in q(SEED, "background") && !("q" in q(SEED, "item")), "background is asked the same way; item depends on the request");
  q(doc, "background").q = "Which problem does it solve?";
  q(doc, "item").q = "A text the code would never use";
  q(doc, "item").label = "x".repeat(200);
  doc.questions.push({ key: "secret", label: "New question", q: "?" });
  g(doc, "audience").texts.marketing = "  our top clients  ";
  g(doc, "audience").texts["no-such-category"] = "dropped";
  delete g(doc, "audience").texts._;                       // the text for any other category comes back from the seed
  g(doc, "audience").owner = "Someone else";               // who maintains it comes from the seed
  g(doc, "out_of_scope").texts.legal = "";                 // empty: the category falls back to "any other category"
  const out = sanitize(doc);
  assert.equal(q(out, "background").q, "Which problem does it solve?");
  assert.equal("q" in q(out, "item"), false);
  assert.equal(q(out, "item").label.length, 80);
  assert.equal(out.questions.length, SEED.questions.length);
  assert.deepEqual([g(out, "audience").texts.marketing, g(out, "audience").texts["no-such-category"], g(out, "audience").texts._, g(out, "audience").owner],
    ["our top clients", undefined, g(SEED, "audience").texts._, "Category Managers"]);
  assert.equal("legal" in g(out, "out_of_scope").texts, false);
  assert.deepEqual(validateConfig(configFrom(out, 0, "draft")), []);
});

test("a reason text may use only the placeholders its rule fills; a document from before questions and guidance existed is completed from the seed", () => {
  const { SEED, validateConfig, configFrom, bodyOf } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const doc = structuredClone(SEED);
  doc.rules.find((r) => r.id === "R02").rows[1].text = "Ask {supplier} under {contract}, {lead_threshold} applies.";
  assert.deepEqual(validateConfig(configFrom(doc, 0, "draft")), ['R02: row 2: the text uses {lead_threshold}, which this rule does not fill (it fills {contract} {supplier} {remaining} {expires})']);
  const old = structuredClone(SEED); delete old.questions; delete old.guidance;
  const full = bodyOf(old);
  assert.deepEqual([full.questions.length, full.guidance.length], [SEED.questions.length, SEED.guidance.length]);
  assert.deepEqual(validateConfig(configFrom(old, 2, "database")), []);
});

test("a guidance text published on the admin endpoint is served to the page", async () => {
  process.env.ADMIN_CODE = "admin-secret";
  const { admin, config } = loadAll();
  const start = (await call(admin, { headers: H })).body;
  const doc = structuredClone(start.draft);
  doc.guidance.find((x) => x.key === "audience").texts.marketing = "our top 40 clients";
  doc.questions.find((x) => x.key === "background").q = "Which problem does it solve?";
  const saved = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc, revision: start.revision, actor: "Test" } })).body;
  assert.equal(saved.changes, 2);
  await call(admin, { method: "POST", headers: H, body: { action: "publish", revision: saved.revision, note: "Guidance" } });
  const live = (await call(config)).body;
  assert.equal(live.guidance.find((x) => x.key === "audience").texts.marketing, "our top 40 clients");
  assert.equal(live.questions.find((x) => x.key === "background").q, "Which problem does it solve?");
});

test("a stored version from before placeholders were listed is still valid: placeholders always come from the seed", () => {
  const { SEED, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const old = structuredClone(SEED); old.rules.forEach((r) => delete r.placeholders); delete old.questions; delete old.guidance;
  assert.deepEqual(validateConfig(configFrom(old, 2, "database")), []);
  const forged = structuredClone(SEED); forged.rules.find((r) => r.id === "R02").placeholders.push("lead_threshold");
  assert.deepEqual(configFrom(forged, 2, "database").rules.find((r) => r.id === "R02").placeholders, ["contract", "supplier", "remaining", "expires"]);
});
