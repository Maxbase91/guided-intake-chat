/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// Where the configuration and the decision log live. Two stores with the same interface:
//   Postgres (DATABASE_URL set): Neon in production, any Postgres locally.
//   Memory (no DATABASE_URL): the seed, for tests and for running locally without a database. Nothing is kept.
const { SEED, bodyOf, checksumOf, configFrom } = require("./seed");

const DECISION_CAP = 2000;

function memoryStore() {
  const versions = [], decisions = [];
  let draft = { doc: structuredClone(bodyOf(SEED)), base_version: 0, revision: 1, updated_at: new Date().toISOString(), updated_by: "seed" };
  return {
    kind: "memory",
    // the seed itself until something is published, so the page sees exactly its built-in defaults
    async getPublished() {
      const v = versions[versions.length - 1];
      return v ? configFrom(v.doc, v.version, "database") : configFrom(structuredClone(SEED), 0, "builtin");
    },
    async saveDecisions(batch) {
      let stored = 0;
      for (const d of batch.decisions) {
        if (decisions.some((x) => x.conversation_id === batch.conversation_id && x.seq === d.seq)) continue;
        decisions.push({ ...d, conversation_id: batch.conversation_id, config_version: batch.config_version, config_source: batch.config_source, config_checksum: batch.config_checksum, received_at: new Date().toISOString() });
        stored++;
      }
      if (decisions.length > DECISION_CAP) decisions.splice(0, decisions.length - DECISION_CAP);
      return stored;
    },
    async listDecisions(limit = 100) { return decisions.slice(-limit).reverse(); },
    _state: { versions, decisions, get draft() { return draft; }, set draft(d) { draft = d; } },
    async close() {},
  };
}

function postgresStore(url) {
  const { Pool } = require("pg");
  // a function instance serves one request at a time: a small pool, released quickly
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
  pool.on("error", () => {});   // an idle client dropped by the server must not crash the function
  return {
    kind: "postgres",
    pool,
    async getPublished() {
      const r = await pool.query("select version, doc from config_versions order by version desc limit 1");
      if (!r.rows.length) throw Object.assign(new Error("No configuration is published yet"), { code: "not_seeded" });
      return configFrom(r.rows[0].doc, r.rows[0].version, "database");
    },
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
    async close() { await pool.end(); },
  };
}

let current = null;
// one store per function instance; tests pass their own URL or ask for the memory store
function getStore() {
  if (!current) current = process.env.DATABASE_URL ? postgresStore(process.env.DATABASE_URL) : memoryStore();
  return current;
}

module.exports = { getStore, memoryStore, postgresStore, checksumOf };
