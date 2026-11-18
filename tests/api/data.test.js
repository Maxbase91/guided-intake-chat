// The configuration and decision-log endpoints and the store behind them. They run on the memory store; with
// TEST_DATABASE_URL set (scripts/verify.sh and CI start a Postgres) the store tests run against the database too.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ENV = ["ACCESS_CODE", "DATABASE_URL", "VERCEL", "DECISIONS_LIMIT_PER_MIN", "CONFIG_LIMIT_PER_MIN"];
let saved;
// fresh modules per test, as after a cold start: the rate limit, the config cache and the store are module state
function load(name) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  return require(path.join(ROOT, "api", name));
}
function call(handler, { method = "GET", query = {}, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); return this; } };
    Promise.resolve(handler({ method, query, headers, body }, res)).catch(reject);
  });
}
const ID = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
const batch = (extra = {}) => ({ conversation_id: ID, config_version: 0, config_source: "builtin", config_checksum: "14323fb256ea",
  decisions: [{ seq: 0, rule: "R11", row: 6, outcome: "division", facts: { annual_value: 30000, value_known: true, category: "marketing", cat_cm_mandatory: false, request_type: "new" } },
    { seq: 1, rule: "R19", row: 4, outcome: "business", facts: { r11: "division", total_value: 30000 } }], ...extra });

beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); ENV.forEach((k) => delete process.env[k]); });
afterEach(() => { ENV.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); });

test("GET /api/config without a database serves the seed as the built-in configuration", async () => {
  const { buildConfig } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const r = await call(load("config.js"));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, buildConfig());
  assert.deepEqual([r.body.version, r.body.source], [0, "builtin"]);
  assert.match(r.headers["cache-control"], /no-store/);
});

test("GET /api/config needs the access code when one is set, and only answers GET", async () => {
  process.env.ACCESS_CODE = "demo-code";
  const handler = load("config.js");
  assert.equal((await call(handler)).status, 401);
  assert.equal((await call(handler, { headers: { "x-access-code": "wrong" } })).body.code, "access_code");
  assert.equal((await call(handler, { headers: { "x-access-code": "demo-code" } })).status, 200);
  assert.equal((await call(handler, { method: "POST", headers: { "x-access-code": "demo-code" } })).status, 405);
});

test("POST /api/decisions stores a batch once; sending it again stores nothing new", async () => {
  const handler = load("decisions.js"), store = require(path.join(ROOT, "api", "_lib", "store.js")).getStore();
  assert.deepEqual((await call(handler, { method: "POST", body: batch() })).body, { stored: 2 });
  assert.deepEqual((await call(handler, { method: "POST", body: JSON.stringify(batch()) })).body, { stored: 0 });
  const rows = await store.listDecisions();
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["config_checksum", "config_source", "config_version", "conversation_id", "facts", "outcome", "received_at", "row", "rule", "seq"]);
});

test("POST /api/decisions refuses free text, unknown facts and malformed batches", async () => {
  process.env.DECISIONS_LIMIT_PER_MIN = "0";   // the limit has its own test
  const handler = load("decisions.js"), post = (body) => call(handler, { method: "POST", body });
  const withFacts = (facts) => batch({ decisions: [{ seq: 0, rule: "R11", row: 1, outcome: "division", facts }] });
  for (const [name, body, part] of [
    ["free text in a fact", withFacts({ category: "An agency for a client dinner for 40 people" }), "short code"],
    ["a name in a fact", withFacts({ category: "Lakeshore Advisory" }), "short code"],
    ["an unknown fact", withFacts({ supplier: "x" }), "Unknown fact"],
    ["an object as a value", withFacts({ annual_value: { $gt: 1 } }), "annual_value"],
    ["a bad conversation id", batch({ conversation_id: "REQ-123456" }), "UUID"],
    ["a bad rule id", batch({ decisions: [{ seq: 0, rule: "drop table", row: 1, outcome: "x" }] }), "seq, rule, row and outcome"],
    ["text as the outcome", batch({ decisions: [{ seq: 0, rule: "R11", row: 1, outcome: "The division leads!" }] }), "seq, rule, row and outcome"],
    ["a repeated seq", batch({ decisions: [{ seq: 0, rule: "R11", row: 1, outcome: "a" }, { seq: 0, rule: "R19", row: 1, outcome: "b" }] }), "unique"],
    ["too many rows", batch({ decisions: Array.from({ length: 51 }, (_, i) => ({ seq: i, rule: "R11", row: 1, outcome: "a" })) }), "1 to 50"],
    ["an unknown source", batch({ config_source: "elsewhere" }), "configuration"],
    ["no body", undefined, "missing"],
    ["an oversized body", batch({ pad: "x".repeat(66000) }), "too large"],
  ]) {
    const r = await post(body);
    assert.equal(r.status, 400, name);
    assert.equal(r.body.code, "invalid_request", name);
    assert.ok(r.body.error.includes(part), `${name}: ${r.body.error}`);
  }
  assert.equal((await call(handler, { method: "GET" })).status, 405);
});

test("POST /api/decisions is rate limited per IP, needs the access code, and is refused in production without a database", async () => {
  process.env.DECISIONS_LIMIT_PER_MIN = "2";
  let handler = load("decisions.js");
  const from = (ip, n) => call(handler, { method: "POST", headers: { "x-forwarded-for": ip }, body: batch({ decisions: [{ seq: n, rule: "R11", row: 1, outcome: "division" }] }) });
  assert.deepEqual([(await from("1.1.1.1", 0)).status, (await from("1.1.1.1", 1)).status, (await from("1.1.1.1", 2)).status, (await from("2.2.2.2", 3)).status], [200, 200, 429, 200]);
  process.env.ACCESS_CODE = "demo-code";
  handler = load("decisions.js");
  assert.equal((await call(handler, { method: "POST", body: batch() })).status, 401);
  assert.equal((await call(handler, { method: "POST", headers: { "x-access-code": "demo-code" }, body: batch() })).status, 200);
  process.env.VERCEL = "1";
  handler = load("decisions.js");
  const r = await call(handler, { method: "POST", headers: { "x-access-code": "demo-code" }, body: batch() });
  assert.deepEqual([r.status, r.body.code], [503, "no_database"]);
});

test("Postgres: migrate, seed once, read the published configuration, and keep the decision log", { skip: !process.env.TEST_DATABASE_URL && "TEST_DATABASE_URL is not set" }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  const { Client } = require("pg");
  const { migrate } = require(path.join(ROOT, "scripts", "db-migrate.js")), { seed } = require(path.join(ROOT, "scripts", "db-seed.js"));
  const { buildConfig } = require(path.join(ROOT, "api", "_lib", "seed.js"));
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query("drop table if exists decisions, admin_attempts, audit_log, config_draft, config_versions, schema_migrations cascade");
  await admin.end();

  process.env.DATABASE_URL = url;
  let store = load(path.join("_lib", "store.js")).getStore();
  try {
    assert.equal(store.kind, "postgres");
    assert.deepEqual(await migrate(url), ["001_init.sql"]);
    assert.deepEqual(await migrate(url), []);
    await assert.rejects(store.getPublished(), { code: "not_seeded" });
    assert.equal((await call(load("config.js"))).body.code, "not_seeded");
    assert.deepEqual(await seed(url), { seeded: true, version: 1 });
    assert.deepEqual(await seed(url), { seeded: false, version: 1, reason: "published" });
    assert.deepEqual(await seed(url, { update: true }), { seeded: false, version: 1, reason: "same" });

    await store.close();
    store = load(path.join("_lib", "store.js")).getStore();
    const cfg = await store.getPublished();
    assert.deepEqual({ ...cfg, version: 0, source: "builtin" }, buildConfig());   // the same document, as version 1 from the database
    assert.deepEqual([cfg.version, cfg.source], [1, "database"]);

    assert.equal(await store.saveDecisions(batch()), 2);
    assert.equal(await store.saveDecisions(batch()), 0);
    const rows = await store.listDecisions();
    assert.equal(rows.length, 2);
    assert.deepEqual({ rule: rows[1].rule, row: rows[1].row, outcome: rows[1].outcome, facts: rows[1].facts.annual_value, v: rows[1].config_version }, { rule: "R11", row: 6, outcome: "division", facts: 30000, v: 0 });
  } finally { await store.close(); }
});
