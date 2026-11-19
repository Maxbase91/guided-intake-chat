/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// The configuration document and its validation. The seed (db/seed/*.json) is the starting configuration: the page's
// built-in defaults are generated from it and the database is filled from it once.
const crypto = require("crypto");
const Engine = require("../../engine.js");

// reference data: the Level 4 list, suppliers, framework contracts and the catalogue (example data in the seed)
const REF_PARTS = ["l4", "suppliers", "contracts", "catalogue"];
const PARTS = ["params", "channels", "categories", "facts", "rules", "questions", "guidance", "divisions", "lists", "next_steps", "entities", "domains", "examples", ...REF_PARTS];
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
  next_steps: require("../../db/seed/next_steps.json"),
  entities: require("../../db/seed/entities.json"),
  domains: require("../../db/seed/domains.json"),
  examples: require("../../db/seed/examples.json"),
  l4: require("../../db/seed/l4.json"),
  suppliers: require("../../db/seed/suppliers.json"),
  contracts: require("../../db/seed/contracts.json"),
  catalogue: require("../../db/seed/catalogue.json"),
};

// a document saved before a part existed gets that part from the seed
const withDefaults = (doc) => {
  const out = Object.fromEntries(PARTS.map((k) => [k, Array.isArray(doc && doc[k]) ? doc[k] : structuredClone(SEED[k])]));
  // the placeholders a rule fills are set by the code, so they always come from the seed
  out.rules = out.rules.map((r) => { const seed = SEED.rules.find((x) => x.id === (r && r.id)); return seed ? { ...r, placeholders: [...(seed.placeholders || [])] } : r; });
  // a rule added to the code after the document was saved comes from the seed (R07 and R08 for versions 1 and 2)
  SEED.rules.forEach((r) => { if (!out.rules.some((x) => x && x.id === r.id)) out.rules.push(structuredClone(r)); });
  // likewise a question, a fact or a threshold added later; a step list's placeholders come from the code
  for (const part of ["questions", "facts", "params"]) SEED[part].forEach((q) => { if (!out[part].some((x) => x && x.key === q.key)) out[part].push(structuredClone(q)); });
  out.params = out.params.map((p) => { const seed = SEED.params.find((x) => x.key === (p && p.key)); return seed ? { ...seed, value: p.value } : p; });
  out.next_steps = out.next_steps.map((n) => { const seed = SEED.next_steps.find((x) => x.key === (n && n.key)); return seed ? { ...n, label: seed.label, placeholders: [...seed.placeholders] } : n; });
  // a question saved before its answer buttons were editable keeps the seed's buttons
  out.questions = out.questions.map((q) => { const seed = SEED.questions.find((x) => x.key === (q && q.key)); return seed && seed.choices && !Array.isArray(q.choices) ? { ...q, choices: [...seed.choices] } : q; });
  return out;
};
const bodyOf = (doc) => withDefaults(doc);
// key order must not matter: a document read back from a jsonb column has its keys in another order
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const refChecksumOf = (doc) => crypto.createHash("sha256").update(JSON.stringify(canon(REF_PARTS.map((k) => withDefaults(doc)[k])))).digest("hex").slice(0, 12);
const checksumOf = (doc) => crypto.createHash("sha256").update(JSON.stringify(canon(bodyOf(doc)))).digest("hex").slice(0, 12);
// the document the page reads: { version, source, checksum, params, channels, categories, facts, rules }
const configFrom = (doc, version, source) => ({ version, source, checksum: checksumOf(doc), ref_checksum: refChecksumOf(doc), ...bodyOf(doc) });
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
  errors.push(...validateTexts(cfg, params));
  errors.push(...validateReference(cfg));
  const ids = cfg.rules.map((r) => r.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`rule ${id} is defined twice`));
  for (const id of SEED.rules.map((r) => r.id)) if (!ids.includes(id)) errors.push(`rule ${id} is missing`);
  return errors;
}

// next steps, entities, domains, welcome examples and the limits that must be in order
function validateTexts(cfg, P) {
  const errors = [];
  const order = (lo, hi, what) => { if (P[lo] > P[hi]) errors.push(`${what}: the lower limit is above the upper one`); };
  order("headMinProc", "headMaxProc", "headline, procurement-led"); order("execMinProc", "execMaxProc", "executive description, procurement-led");
  order("headMin", "headMax", "headline, other routes"); order("execMin", "execMax", "executive description, other routes");
  order("checkDayTypicalMin", "checkDayTypicalMax", "typical day rate");
  if (!(P.qualityStrong > P.qualityGood && P.qualityGood > P.qualityFair)) errors.push("quality ratings: Strong must start above Good, and Good above Fair");
  if (P.qualityFloor > 100 || P.qualityStrong > 100 || P.qualityMin > 100) errors.push("quality score: limits are out of 100");
  for (const n of SEED.next_steps) {
    const have = cfg.next_steps.find((x) => x.key === n.key);
    if (!have || !(have.steps || []).length) { errors.push(`next steps, ${n.label}: no steps`); continue; }
    have.steps.forEach((t, i) => {
      if (!String(t || "").trim()) errors.push(`next steps, ${n.label}, step ${i + 1}: empty`);
      for (const m of String(t || "").matchAll(/\{(\w+)\}/g)) if (!n.placeholders.includes(m[1])) errors.push(`next steps, ${n.label}, step ${i + 1}: uses {${m[1]}}, which is not filled here (${n.placeholders.map((x) => `{${x}}`).join(" ") || "no placeholders"})`);
    });
  }
  for (const e of SEED.entities) { const have = cfg.entities.find((x) => x.id === e.id); if (!have || !String(have.name || "").trim() || !((have.keywords || []).length + (have.codes || []).length)) errors.push(`legal entity ${e.id}: needs a name and at least one search word or short code`); }
  for (const d of SEED.domains) { const have = cfg.domains.find((x) => x.id === d.id); if (!have || !String(have.name || "").trim() || !(have.keywords || []).length) errors.push(`operations domain ${d.id}: needs a name and at least one search word`); }
  if (cfg.examples.length < 3) errors.push("welcome examples: at least 3");
  return errors;
}

// the reference data must hang together: unique keys, every Level 4 in a known category, every link to an existing entry
function validateReference(cfg) {
  const errors = [], say = (m) => { if (errors.length < 50) errors.push(m); };
  const themes = new Set(cfg.categories.map((c) => c.id)), codes = new Set();
  const dup = (label, list, key) => { const seen = new Set(); list.forEach((x) => { if (seen.has(x[key])) say(`${label} ${x[key]}: listed twice`); seen.add(x[key]); }); };
  if (!cfg.l4.length) say("Level 4 list: empty");
  cfg.l4.forEach((e) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(String(e.code || ""))) say(`Level 4 ${e.code || "(no code)"}: the code may only use letters, digits, dots, dashes`);
    if (!String(e.name || "").trim()) say(`Level 4 ${e.code}: no name`);
    if (!themes.has(e.theme)) say(`Level 4 ${e.code}: category "${e.theme}" is not one of the buying categories`);
    codes.add(e.code);
  });
  dup("Level 4", cfg.l4, "code");
  cfg.suppliers.forEach((sp) => { if (!String(sp.name || "").trim()) say("Supplier without a name"); (sp.preferred_l4 || []).forEach((c) => { if (!codes.has(c)) say(`Supplier ${sp.name}: preferred for ${c}, which is not in the Level 4 list`); }); });
  dup("Supplier", cfg.suppliers, "name");
  cfg.contracts.forEach((c) => {
    if (!String(c.id || "").trim() || !String(c.supplier || "").trim() || !String(c.title || "").trim()) say(`Contract ${c.id || "(no id)"}: needs an id, a supplier and a title`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.expires || "")) || isNaN(Date.parse(c.expires))) say(`Contract ${c.id}: the end date must be YYYY-MM-DD`);
    if (typeof c.remaining !== "number" || c.remaining < 0) say(`Contract ${c.id}: the remaining value must be a number`);
    if (!(c.l4 || []).length) say(`Contract ${c.id}: covers no Level 4`);
    (c.l4 || []).forEach((x) => { if (!codes.has(x)) say(`Contract ${c.id}: covers ${x}, which is not in the Level 4 list`); });
  });
  dup("Contract", cfg.contracts, "id");
  cfg.catalogue.forEach((i) => {
    if (!["item", "shop"].includes(i.kind)) say(`Catalogue ${i.id}: kind must be item or shop`);
    if (!codes.has(i.l4)) say(`Catalogue ${i.id}: Level 4 ${i.l4} is not in the Level 4 list`);
    if (i.kind === "item" && !(typeof i.price === "number" && i.price > 0)) say(`Catalogue ${i.id}: an item needs a price`);
    if (i.kind === "shop" && !(typeof i.max_order === "number" && i.max_order > 0)) say(`Catalogue ${i.id}: a shop needs a maximum order value`);
    if (!String(i.name || "").trim() || !String(i.supplier || "").trim()) say(`Catalogue ${i.id}: needs a name and a supplier`);
  });
  dup("Catalogue", cfg.catalogue, "id");
  return errors;
}

module.exports = { PARTS, REF_PARTS, refChecksumOf, validateReference, SEED, withDefaults, bodyOf, canon, checksumOf, configFrom, buildConfig, validateConfig };
