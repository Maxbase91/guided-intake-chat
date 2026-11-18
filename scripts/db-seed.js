#!/usr/bin/env node
// Publishes the seed (db/seed/*.json) as version 1 and makes it the working draft. Run: npm run db:seed
// Does nothing when a configuration is already published: the database is then the source of truth, and the seed must
// not overwrite what was changed in the admin page.
const { Client } = require("pg");
const { SEED, bodyOf, checksumOf, validateConfig, buildConfig } = require("../api/_lib/seed.js");

async function seed(url) {
  const errors = validateConfig(buildConfig());
  if (errors.length) throw new Error("The seed is not valid:\n  " + errors.join("\n  "));
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("lock table config_versions in exclusive mode");
    const have = (await client.query("select max(version) as v from config_versions")).rows[0].v;
    if (have) { await client.query("rollback"); return { seeded: false, version: have }; }
    const doc = JSON.stringify(bodyOf(SEED));
    await client.query("insert into config_versions (version, actor, note, checksum, doc) values (1, 'seed', 'Initial configuration from db/seed', $1, $2)", [checksumOf(SEED), doc]);
    await client.query("insert into config_draft (id, doc, base_version) values (1, $1, 1) on conflict (id) do update set doc = excluded.doc, base_version = 1, revision = config_draft.revision + 1, updated_at = now(), updated_by = 'seed'", [doc]);
    await client.query("insert into audit_log (actor, action, version) values ('seed', 'seed', 1)");
    await client.query("commit");
    return { seeded: true, version: 1 };
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { await client.end(); }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) { console.error("Set DATABASE_URL_UNPOOLED or DATABASE_URL."); process.exit(1); }
  seed(url).then((r) => console.log(r.seeded ? "seeded: version 1 published" : `already seeded: version ${r.version} is published, nothing changed`), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { seed };
