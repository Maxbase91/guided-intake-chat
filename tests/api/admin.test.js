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
      doc.categories[0].secret = "x"; doc.categories[0].cm_mandatory = "yes";   // unknown field; not a boolean
      doc.rules.find((r) => r.id === "R11").outcomes[0].lead = "nobody";      // outcome attributes come from the seed
      doc.rules.push({ id: "R99", rows: [] });                                 // unknown rule
      doc.extra = { anything: true };
      const savedDraft = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc, revision: start.revision, actor: "  Test Admin  " } })).body;
      assert.equal(savedDraft.changes, 1);
      assert.equal(savedDraft.dirty, true);
      assert.equal(param(savedDraft.draft, "formMin").value, 20000);
      assert.equal(param(savedDraft.draft, "leadMin").label, param(start.draft, "leadMin").label);
      assert.deepEqual([savedDraft.draft.params.length, savedDraft.draft.channels.length, savedDraft.draft.rules.length, "extra" in savedDraft.draft], [start.draft.params.length, 4, start.draft.rules.length, false]);
      assert.deepEqual([savedDraft.draft.categories[0].secret, savedDraft.draft.categories[0].cm_mandatory], [undefined, false]);
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

test("a stored version from before a rule, question or fact existed gets it from the seed", () => {
  const { SEED, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const old = structuredClone(SEED);
  old.rules = old.rules.filter((r) => !["R07", "R08"].includes(r.id));
  old.questions = old.questions.filter((q) => q.key !== "division");
  old.facts = old.facts.filter((f) => f.key !== "division");
  delete old.divisions; delete old.lists;
  const cfg = configFrom(old, 2, "database");
  assert.deepEqual(validateConfig(cfg), []);
  assert.deepEqual([cfg.rules.map((r) => r.id).slice(-2), cfg.questions.some((q) => q.key === "division"), cfg.divisions.length], [["R07", "R08"], true, 5]);
});

test("reference data: only known fields with their types are kept, and the lists must hang together", () => {
  const { sanitize } = require(path.join(ROOT, "api", "_lib", "validate.js"));
  const { SEED, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const doc = structuredClone(SEED);
  doc.contracts.push({ id: "CTR-9001", supplier: "Gala Events", title: "Events framework", l4: "L4-2301;L4-9999", expires: "2029-12-31", remaining: "500000", secret: "x" });
  doc.catalogue.push({ id: "CAT-9001", kind: "item", name: "Pens", supplier: "Paperhaus Supplies", l4: "L4-2602", price: "", unit: "box", kw: ["PENS*", "<b>"] });
  doc.l4.push({ ...doc.l4[0] });                                    // the same code twice
  doc.l4.push({ code: "L4-9001", name: "Fortune telling", theme: "astrology", kw: [] });
  const out = sanitize(doc), last = (k) => out[k][out[k].length - 1];
  assert.deepEqual(last("contracts"), { id: "CTR-9001", supplier: "Gala Events", title: "Events framework", l4: ["L4-2301", "L4-9999"], expires: "2029-12-31", remaining: 500000 });
  assert.deepEqual([last("catalogue").price, last("catalogue").kw], [null, ["pens*"]]);
  const problems = validateConfig(configFrom(out, 0, "draft"));
  for (const p of ["Level 4 L4-1101: listed twice", 'Level 4 L4-9001: category "astrology" is not one of the buying categories', "Contract CTR-9001: covers L4-9999, which is not in the Level 4 list", "Catalogue CAT-9001: an item needs a price"])
    assert.ok(problems.includes(p), `missing: ${p}\n${problems.join("\n")}`);
});

test("the configuration leaves out the reference data when the page already has the same", async () => {
  const { config } = loadAll();
  const full = (await call(config)).body;
  assert.ok(full.l4.length > 300 && /^[0-9a-f]{12}$/.test(full.ref_checksum));
  const same = (await call(config, { headers: { "x-ref-checksum": full.ref_checksum } })).body;
  assert.deepEqual(["l4", "suppliers", "contracts", "catalogue"].map((k) => k in same), [false, false, false, false]);
  assert.deepEqual([same.checksum, same.ref_checksum, same.rules.length], [full.checksum, full.ref_checksum, full.rules.length]);
  assert.ok("l4" in (await call(config, { headers: { "x-ref-checksum": "000000000000" } })).body);
});

test("an upload is one line in the change log; published reference data is served to the page", async () => {
  process.env.ADMIN_CODE = "admin-secret";
  const { admin, config } = loadAll();
  const before = (await call(config)).body.ref_checksum;
  const start = (await call(admin, { headers: H })).body, doc = structuredClone(start.draft);
  doc.l4.slice(0, 30).forEach((e) => { e.desc = e.desc + " (updated)"; });
  doc.contracts.push({ id: "CTR-9001", supplier: "Gala Events", title: "Events framework", l4: ["L4-2301"], expires: "2029-12-31", remaining: 500000 });
  const saved = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc, revision: start.revision, actor: "Uploader" } })).body;
  assert.deepEqual(saved.problems, []);
  const audit = (await call(admin, { headers: H, query: { view: "audit" } })).body.audit;
  const l4 = audit.filter((a) => a.part === "l4"), ctr = audit.filter((a) => a.part === "contracts");
  assert.deepEqual([l4.length, l4[0].item, l4[0].after], [1, "30 entries", { added: 0, changed: 30, removed: 0 }]);
  assert.deepEqual([ctr.length, ctr[0].item], [1, "CTR-9001"]);
  await call(admin, { method: "POST", headers: H, body: { action: "publish", revision: saved.revision, note: "Events framework" } });
  const live = (await call(config)).body;
  assert.ok(live.contracts.some((c) => c.id === "CTR-9001"));
  assert.notEqual(live.ref_checksum, before);
});

test("a review flag's title, level and reviewer can be changed; whether an outcome raises a flag cannot", () => {
  const { sanitize } = require(path.join(ROOT, "api", "_lib", "validate.js"));
  const { SEED, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const doc = structuredClone(SEED), out0 = (d, id, key) => d.rules.find((r) => r.id === id).outcomes.find((o) => o.key === key);
  Object.assign(out0(doc, "R40", "flag"), { title: "  Large spend review ", level: "b", owner: "Chief Procurement Officer" });
  Object.assign(out0(doc, "R26", "flag"), { level: "red", title: "", flag: false, approval: true });
  Object.assign(out0(doc, "R40", "none"), { flag: true, title: "Sneaky", level: "b" });
  const out = sanitize(doc);
  assert.deepEqual([out0(out, "R40", "flag").title, out0(out, "R40", "flag").level, out0(out, "R40", "flag").owner], ["Large spend review", "b", "Chief Procurement Officer"]);
  assert.deepEqual([out0(out, "R26", "flag").title, out0(out, "R26", "flag").level, out0(out, "R26", "flag").flag, out0(out, "R26", "flag").approval], ["Data protection review", "w", true, undefined]);
  assert.deepEqual([out0(out, "R40", "none").flag, out0(out, "R40", "none").title], [undefined, undefined]);
  assert.deepEqual(validateConfig(configFrom(out, 0, "draft")), []);
});

test("next steps, entities, domains, examples and answer buttons: only known items and fields, with limits", () => {
  const { sanitize } = require(path.join(ROOT, "api", "_lib", "validate.js"));
  const { SEED, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const doc = structuredClone(SEED), part = (d, k, key, id = "key") => d[k].find((x) => x[id] === key);
  part(doc, "next_steps", "business").steps = ["Ask 3 suppliers{preferred}.", "Pay {nonsense}.", ...Array(6).fill("x")];
  part(doc, "next_steps", "business").placeholders = ["nonsense"];             // placeholders come from the seed
  doc.next_steps.push({ key: "secret", label: "?", steps: ["?"] });
  part(doc, "entities", "US", "id").codes = ["US", "u$a!", "toolongcode", "x"];
  doc.entities.push({ id: "XX", name: "New entity", keywords: ["x"] });
  Object.assign(part(doc, "domains", "voice", "id"), { ops: true, important: "", keywords: ["Dictaphone*", "turret"], notes: "y".repeat(900) });
  doc.examples = [...doc.examples, ...Array(10).fill({ group: "G", label: "L", text: "T" })];
  part(doc, "questions", "pricing_model").choices = ["Fixed price", "", "Per milestone"];
  part(doc, "questions", "duration").choices = ["Forever"];                  // feeds the rules: not editable
  const out = sanitize(doc);
  assert.deepEqual(part(out, "next_steps", "business").steps.length, 5);
  assert.deepEqual(part(out, "next_steps", "business").placeholders, ["preferred"]);
  assert.equal(out.next_steps.length, SEED.next_steps.length);
  assert.deepEqual(part(out, "entities", "US", "id").codes, ["US", "ua", "toolon"]);
  assert.equal(out.entities.length, SEED.entities.length);
  const voice = part(out, "domains", "voice", "id");
  assert.deepEqual([voice.ops, voice.important, voice.keywords, voice.notes.length], [false, null, ["dictaphone*", "turret"], 600]);
  assert.equal(out.examples.length, 12);
  assert.deepEqual(part(out, "questions", "pricing_model").choices, ["Fixed price", "Per milestone"]);
  assert.equal("choices" in part(out, "questions", "duration"), false);
  const errs = validateConfig(configFrom(out, 0, "draft"));
  assert.ok(errs.some((e) => /Business-led demand.*step 2.*\{nonsense\}/.test(e)), errs.join("\n"));
  // limits in the wrong order and too few examples are refused
  const bad = sanitize(structuredClone(SEED));
  bad.params.find((p) => p.key === "headMin").value = 80; bad.params.find((p) => p.key === "qualityGood").value = 95; bad.examples = bad.examples.slice(0, 2);
  const e2 = validateConfig(configFrom(bad, 0, "draft"));
  for (const re of [/headline, other routes/, /quality ratings/, /welcome examples/]) assert.ok(e2.some((e) => re.test(e)), `${re}: ${e2.join("; ")}`);
});

test("the admin state carries the published configuration without the reference lists, and which reference lists differ", async () => {
  process.env.ADMIN_CODE = "admin-secret";
  const { admin } = loadAll();
  const start = (await call(admin, { headers: H })).body;
  assert.deepEqual(Object.keys(start.published).sort(), ["categories", "channels", "divisions", "domains", "entities", "examples", "facts", "guidance", "lists", "next_steps", "params", "questions", "rules"]);
  assert.deepEqual(start.changed_ref, []);
  const doc = structuredClone(start.draft);
  doc.contracts = doc.contracts.slice(1);
  param(doc, "leadMin").value = 400000;
  const after = (await call(admin, { method: "POST", headers: H, body: { action: "save", doc, revision: start.revision } })).body;
  assert.deepEqual(after.changed_ref, ["contracts"]);
  assert.equal(param(after.published, "leadMin").value, 500000);   // the published version is unchanged until a publish
  assert.equal(param(after.draft, "leadMin").value, 400000);
});

test("a version published before the small purchase was removed is cleaned when it is read, and still passes the publish check", () => {
  const { SEED, withDefaults, validateConfig, configFrom } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const old = structuredClone(SEED), r19 = old.rules.find((r) => r.id === "R19"), r23 = old.rules.find((r) => r.id === "R23");
  r19.outcomes.splice(2, 0, { key: "simple", label: "Business-led demand, short form for a small purchase", channel: "business" });
  r19.rows.splice(2, 0, { when: [{ fact: "r11", op: "is", value: "division" }, { fact: "simple_eligible", op: "is", value: true }, { fact: "total_value", op: "lte", value: { param: "simpleMax" } }], then: "simple" });
  r19.tests.push({ name: "Small, simple purchase", given: { r11: "division", simple_eligible: true, total_value: { param: "simpleMax", plus: -1 } }, expect: "simple" });
  r19.tests.push({ name: "Small but not simple", given: { r11: "division", simple_eligible: false }, expect: "business" });
  r23.outcomes.push({ key: "one_quote", label: "One quote", flag: true, level: "i", title: "One quote", owner: "The business" });
  r23.rows.splice(1, 0, { when: [{ fact: "route", op: "is", value: "simple" }], then: "one_quote" });
  old.rules.find((r) => r.id === "R39").rows[0].when[0].value = ["simple", "contract", "business", "procurement"];
  old.params.push({ key: "simpleMax", value: 5000, unit: "EUR", label: "Small, simple purchase up to" });
  old.next_steps.push({ key: "simple", label: "Small, simple purchase", placeholders: ["quote_from"], steps: ["Get one quote."] });
  old.channels.find((c) => c.key === "business").short_days = "1–3";
  old.facts.push({ key: "simple_eligible", label: "Simple purchase", type: "bool" });
  const doc = withDefaults(old), R = (id) => doc.rules.find((r) => r.id === id);
  assert.deepEqual(R("R19").rows.map((r) => r.then), ["catalogue", "contract", "business", "procurement"]);
  assert.deepEqual(R("R19").tests.find((t) => t.name === "Small but not simple").given, { r11: "division" });   // the removed fact leaves the test case
  assert.ok(!R("R19").tests.some((t) => t.expect === "simple"));
  assert.deepEqual(R("R23").outcomes.map((o) => o.key), ["flag", "none"]);
  assert.deepEqual(R("R39").rows[0].when[0].value, ["contract", "business", "procurement"]);
  assert.ok(!doc.params.some((p) => p.key === "simpleMax") && !doc.next_steps.some((n) => n.key === "simple") && !doc.facts.some((f) => f.key === "simple_eligible"));
  assert.equal("short_days" in doc.channels.find((c) => c.key === "business"), false);
  assert.deepEqual(validateConfig(configFrom(old, 2, "database")), []);
});

test("a stored version loses the rule mode, gets the guidance texts added since (once), and the facts say where they come from", () => {
  const { SEED, withDefaults } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const { sanitize } = require(path.join(ROOT, "api", "_lib", "validate.js"));
  const old = structuredClone(SEED);
  old.rules.forEach((r) => { r.mode = "enforce"; });
  const aq = old.guidance.find((g) => g.key === "audience_question");
  delete aq.categories; delete aq.texts.consulting; aq.texts.legal = "Our own legal wording";
  const doc = withDefaults(old), g = doc.guidance.find((x) => x.key === "audience_question");
  assert.ok(doc.rules.every((r) => !("mode" in r)));
  assert.equal(g.texts.consulting, SEED.guidance.find((x) => x.key === "audience_question").texts.consulting);   // filled once
  assert.equal(g.texts.legal, "Our own legal wording");                                                        // saved texts kept
  assert.deepEqual(g.categories, ["consulting", "legal", "marketing", "training", "it-services", "audit-tax"]);
  // saved after the change (it names its categories): an emptied text stays empty
  const later = sanitize(doc), lg = later.guidance.find((x) => x.key === "audience_question");
  delete lg.texts.consulting;
  assert.equal(withDefaults(later).guidance.find((x) => x.key === "audience_question").texts.consulting, undefined);
  assert.ok(later.rules.every((r) => !("mode" in r)));
  assert.ok(doc.facts.every((f) => f.source && Array.isArray(f.from)));
});
