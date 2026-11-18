/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// The configuration document and its validation. The seed (db/seed/*.json) is the starting configuration: the page's
// built-in defaults are generated from it and the database is filled from it once.
const crypto = require("crypto");
const Engine = require("../../engine.js");

const PARTS = ["params", "channels", "categories", "facts", "rules"];
const SEED = {
  params: require("../../db/seed/params.json"),
  channels: require("../../db/seed/channels.json"),
  categories: require("../../db/seed/categories.json"),
  facts: require("../../db/seed/facts.json"),
  rules: require("../../db/seed/rules.json"),
};

const bodyOf = (doc) => Object.fromEntries(PARTS.map((k) => [k, doc[k]]));
// key order must not matter: a document read back from a jsonb column has its keys in another order
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const checksumOf = (doc) => crypto.createHash("sha256").update(JSON.stringify(canon(bodyOf(doc)))).digest("hex").slice(0, 12);
// the document the page reads: { version, source, checksum, params, channels, categories, facts, rules }
const configFrom = (doc, version, source) => ({ version, source, checksum: checksumOf(doc), ...bodyOf(doc) });
const buildConfig = () => configFrom(structuredClone(SEED), 0, "builtin");

// everything a configuration must satisfy before it is published; returns a list of problems in plain words
function validateConfig(cfg) {
  const errors = [];
  for (const k of PARTS) if (!Array.isArray(cfg[k])) return [`${k} is missing`];
  const params = Object.fromEntries(cfg.params.map((p) => [p.key, p.value]));
  const registry = Object.fromEntries(cfg.facts.map((f) => [f.key, f]));
  cfg.params.forEach((p) => { if (typeof p.value !== "number" || !isFinite(p.value) || p.value < 0) errors.push(`threshold ${p.key}: not a number of 0 or more`); });
  for (const key of SEED.params.map((p) => p.key)) if (!(key in params)) errors.push(`threshold ${key} is missing`);
  if (params.formMin > params.leadMin) errors.push("the sourcing request form threshold is above the threshold from which procurement leads");
  for (const c of SEED.channels) { const have = cfg.channels.find((x) => x.key === c.key); if (!have || !String(have.name || "").trim()) errors.push(`channel ${c.key} has no name`); }
  if (cfg.channels.length !== SEED.channels.length) errors.push("there are exactly four buying channels");
  cfg.rules.forEach((rule) => {
    errors.push(...Engine.validateRule(rule, registry, params));
    Engine.runTests(rule, params).filter((t) => !t.ok).forEach((t) => errors.push(`${rule.id}: test "${t.name}" expects ${t.expect}, got ${t.got}`));
  });
  const ids = cfg.rules.map((r) => r.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`rule ${id} is defined twice`));
  for (const id of SEED.rules.map((r) => r.id)) if (!ids.includes(id)) errors.push(`rule ${id} is missing`);
  return errors;
}

module.exports = { PARTS, SEED, bodyOf, canon, checksumOf, configFrom, buildConfig, validateConfig };
