#!/usr/bin/env node
// Publishes the seed (db/seed/*.json) as version 1 and makes it the working draft. Run: npm run db:seed
// Does nothing when a configuration is already published: the database is then the source of truth, and the seed must
// not overwrite what was changed in the admin page.
//   npm run db:seed -- --update   publish a changed seed as the next version, but only while every published version
//                                 still came from the seed (nothing was published from the admin page)
const { Client } = require("pg");
const { SEED, bodyOf, checksumOf, validateConfig, buildConfig } = require("../api/_lib/seed.js");

async function seed(url, { update = false } = {}) {
  const errors = validateConfig(buildConfig());
  if (errors.length) throw new Error("The seed is not valid:\n  " + errors.join("\n  "));
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("lock table config_versions in exclusive mode");
    const have = (await client.query("select max(version) as v from config_versions")).rows[0].v;
    const doc = JSON.stringify(bodyOf(SEED));
    if (have) {
      const edited = (await client.query("select count(*)::int as n from config_versions where actor <> 'seed'")).rows[0].n;
      const current = (await client.query("select checksum from config_versions where version = $1", [have])).rows[0].checksum;
      if (!update || edited || current === checksumOf(SEED)) { await client.query("rollback"); return { seeded: false, version: have, reason: !update ? "published" : edited ? "edited" : "same" }; }
    }
    const version = (have || 0) + 1;
    await client.query("insert into config_versions (version, actor, note, checksum, doc) values ($1, 'seed', $2, $3, $4)", [version, have ? "Updated configuration from db/seed" : "Initial configuration from db/seed", checksumOf(SEED), doc]);
    await client.query("insert into config_draft (id, doc, base_version) values (1, $1, $2) on conflict (id) do update set doc = excluded.doc, base_version = excluded.base_version, revision = config_draft.revision + 1, updated_at = now(), updated_by = 'seed'", [doc, version]);
    await client.query("insert into audit_log (actor, action, version) values ('seed', 'seed', $1)", [version]);
    await client.query("commit");
    return { seeded: true, version };
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { await client.end(); }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) { console.error("Set DATABASE_URL_UNPOOLED or DATABASE_URL."); process.exit(1); }
  seed(url, { update: process.argv.includes("--update") }).then((r) => console.log(r.seeded ? `seeded: version ${r.version} published` : r.reason === "edited" ? `not updated: version ${r.version} was published from the admin page, which is now the source of truth` : r.reason === "same" ? `up to date: version ${r.version} is the seed` : `already seeded: version ${r.version} is published, nothing changed`), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { seed };
