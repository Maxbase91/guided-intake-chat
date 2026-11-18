#!/usr/bin/env node
// Applies db/migrations/*.sql in name order, each in a transaction, once. Run: npm run db:migrate
// Uses DATABASE_URL_UNPOOLED when set (a direct connection, as schema changes need), else DATABASE_URL.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DIR = path.join(__dirname, "..", "db", "migrations");

async function migrate(url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  const applied = [];
  try {
    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
    for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(name)) continue;
      await client.query("begin");
      try {
        await client.query(fs.readFileSync(path.join(DIR, name), "utf8"));
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
        applied.push(name);
      } catch (e) { await client.query("rollback"); throw new Error(`${name}: ${e.message}`); }
    }
  } finally { await client.end(); }
  return applied;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) { console.error("Set DATABASE_URL_UNPOOLED or DATABASE_URL."); process.exit(1); }
  migrate(url).then((a) => console.log(a.length ? `applied: ${a.join(", ")}` : "nothing to apply"), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { migrate };
