/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// The configuration document and its validation. The seed (db/seed/*.json) is the starting configuration: the page's
// built-in defaults are generated from it and the database is filled from it once.
const crypto = require("crypto");
const Engine = require("../../engine.js");

const PARTS = ["params", "channels", "categories", "facts", "rules", "questions", "guidance", "divisions", "lists"];
const SEED = {
  params: require("../../db/seed/params.json"),
  channels: require("../../db/seed/channels.json"),
  categories: require("../../db/seed/categories.json"),
  facts: require("../../db/seed/facts.json"),
  rules: require("../../db/seed/rules.json"),
  questions: require("../../db/seed/questions.json"),
  guidance: require("../../db/seed/guidance.json"),
  divisions: require("../../db/seed/divisions.json"),
  lists: require("../../db/seed/lists.json"),
};

// a document saved before a part existed gets that part from the seed
const withDefaults = (doc) => {
  const out = Object.fromEntries(PARTS.map((k) => [k, Array.isArray(doc && doc[k]) ? doc[k] : structuredClone(SEED[k])]));
  // the placeholders a rule fills are set by the code, so they always come from the seed
  out.rules = out.rules.map((r) => { const seed = SEED.rules.find((x) => x.id === (r && r.id)); return seed ? { ...r, placeholders: [...(seed.placeholders || [])] } : r; });
  // a rule added to the code after the document was saved comes from the seed (R07 and R08 for versions 1 and 2)
  SEED.rules.forEach((r) => { if (!out.rules.some((x) => x && x.id === r.id)) out.rules.push(structuredClone(r)); });
  // likewise a question or a fact added later
  for (const part of ["questions", "facts"]) SEED[part].forEach((q) => { if (!out[part].some((x) => x && x.key === q.key)) out[part].push(structuredClone(q)); });
  return out;
};
const bodyOf = (doc) => withDefaults(doc);
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
  cfg.rules.forEach((rule) => (rule.rows || []).forEach((row, i) => {
    const allowed = rule.placeholders || [];
    for (const m of String(row.text || "").matchAll(/\{(\w+)\}/g)) if (!allowed.includes(m[1])) errors.push(`${rule.id}: row ${i + 1}: the text uses {${m[1]}}, which this rule does not fill (it fills ${allowed.map((x) => `{${x}}`).join(" ") || "nothing"})`);
  }));
  for (const q of SEED.questions) {
    const have = cfg.questions.find((x) => x.key === q.key);
    if (!have || !String(have.label || "").trim()) errors.push(`question ${q.key} has no label`);
    else if ("q" in q && !String(have.q || "").trim()) errors.push(`question ${q.key} has no question text`);
  }
  for (const g of SEED.guidance) {
    const have = cfg.guidance.find((x) => x.key === g.key);
    if (!have) errors.push(`guidance ${g.key} is missing`);
    else if ("_" in g.texts && !String((have.texts || {})._ || "").trim()) errors.push(`guidance ${g.label}: the text for any other category is empty`);
  }
  for (const d of SEED.divisions) { const have = cfg.divisions.find((x) => x.id === d.id); if (!have || !String(have.name || "").trim() || !String(have.vendor_office || "").trim()) errors.push(`division ${d.id} has no name or vendor office`); }
  for (const l of SEED.lists) { const have = cfg.lists.find((x) => x.key === l.key); if (!have) errors.push(`list ${l.key} is missing`); else (have.items || []).forEach((it, i) => { if (!String(it.name || "").trim() || !(it.keywords || []).length) errors.push(`${l.label}, entry ${i + 1}: needs a name and at least one search word`); }); }
  const ids = cfg.rules.map((r) => r.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`rule ${id} is defined twice`));
  for (const id of SEED.rules.map((r) => r.id)) if (!ids.includes(id)) errors.push(`rule ${id} is missing`);
  return errors;
}

module.exports = { PARTS, SEED, withDefaults, bodyOf, canon, checksumOf, configFrom, buildConfig, validateConfig };
