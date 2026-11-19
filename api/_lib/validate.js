/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// What the admin page may change, and nothing else. sanitize() rebuilds a configuration document from what was sent:
// known items and fields only, with their types and lengths. Anything else in the request is dropped. The structure
// the code relies on (which thresholds, channels, categories, facts and rules exist, and the attributes of a rule's
// outcomes) comes from the seed and cannot be edited.
const Engine = require("../../engine.js");
const { SEED } = require("./seed");

const text = (v, max, dflt = "") => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : dflt);
const int = (v, min, max, dflt) => (Number.isInteger(v) && v >= min && v <= max ? v : dflt);
const LEVELS = ["i", "w", "b"];   // a review flag: information, review needed, procurement checks
const DOMAIN_TEXTS = ["bg", "aud", "fun", "ben", "kpi", "sl", "reg", "out", "qual", "personal", "important", "deps", "notes", "mh"];
const MAX = { rows: 30, conditions: 6, tests: 40, list: 20 };
const FACTS = Object.fromEntries(SEED.facts.map((f) => [f.key, f]));

// a condition value: a number, true/false, a short text, a list of short texts, or a reference to a threshold
function value(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return typeof v.param === "string" ? { param: text(v.param, 40) } : null;
  if (Array.isArray(v)) return v.slice(0, MAX.list).map((x) => (typeof x === "string" ? text(x, 60) : x)).filter((x) => ["string", "number", "boolean"].includes(typeof x));
  if (typeof v === "boolean" || (typeof v === "number" && isFinite(v))) return v;
  return typeof v === "string" ? text(v, 60) : null;
}
// in a test case a number can be a threshold, plus or minus something: { param, plus }
const givenValue = (v) => (v && typeof v === "object" && !Array.isArray(v) && typeof v.param === "string" ? { param: text(v.param, 40), ...(Number.isInteger(v.plus) && v.plus ? { plus: Math.max(-1e9, Math.min(1e9, v.plus)) } : {}) } : value(v));
const condition = (c) => (c && typeof c === "object" ? { fact: text(c.fact, 40), op: text(c.op, 20), ...(Engine.OPS[c.op] && !Engine.OPS[c.op].value ? {} : { value: value(c.value) }) } : null);

function rule(seedRule, r) {
  r = r && typeof r === "object" ? r : {};
  const sent = new Map((Array.isArray(r.outcomes) ? r.outcomes : []).filter((o) => o && typeof o === "object").map((o) => [o.key, o]));
  const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, MAX.rows).filter((x) => x && typeof x === "object").map((x) => {
    const row = { when: (Array.isArray(x.when) ? x.when : []).slice(0, MAX.conditions).map(condition).filter(Boolean), then: text(x.then, 40) };
    const t = text(x.text, 600);
    return t ? { ...row, text: t } : row;
  });
  const tests = (Array.isArray(r.tests) ? r.tests : []).slice(0, MAX.tests).filter((x) => x && typeof x === "object").map((t) => ({
    name: text(t.name, 120, "Test"),
    given: Object.fromEntries(Object.entries(t.given && typeof t.given === "object" && !Array.isArray(t.given) ? t.given : {}).filter(([k]) => FACTS[k]).map(([k, v]) => [k, givenValue(v)]).filter(([, v]) => v !== null && !Array.isArray(v))),
    expect: text(t.expect, 40),
  }));
  return {
    id: seedRule.id, name: text(r.name, 120, seedRule.name), step: seedRule.step, placeholders: [...(seedRule.placeholders || [])],
    clause: text(r.clause, 300), decides: text(r.decides, 400, seedRule.decides),
    // which outcomes exist, and which raise a flag, is fixed; a flag's title, level and reviewer can be changed
    outcomes: seedRule.outcomes.map((o) => {
      const x = sent.get(o.key) || {}, out = { ...o, label: text(x.label, 120, o.label) || o.label };
      if (o.flag) Object.assign(out, { title: text(x.title, 80) || o.title, level: LEVELS.includes(x.level) ? x.level : o.level, owner: text(x.owner, 80) || o.owner || "" });
      return out;
    }),
    rows, tests,
  };
}

// search words: lower case, letters, digits, spaces and a few signs; a trailing * matches longer words
const words = (list, max = 60) => [...new Set((Array.isArray(list) ? list : []).slice(0, max).map((k) => text(k, 40).toLowerCase().replace(/[^a-z0-9äöüß .'&/-]*?(\*?)$/, "$1").replace(/[^a-z0-9äöüß .'&/*-]/g, "").replace(/\*(?!$)/g, "").trim()).filter((k) => k.replace("*", "").length >= 2))];
const num = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
const codes = (list) => (Array.isArray(list) ? list : typeof list === "string" ? list.split(/[;,]/) : []).map((x) => text(String(x), 20)).filter(Boolean).slice(0, 2000);
// reference data: the known fields of each entry, with their types; checked against each other by validateReference
const REF = {
  l4: { max: 5000, clean: (e) => ({ code: text(e.code, 20), name: text(e.name, 120), l1: text(e.l1, 80), l2: text(e.l2, 80), l3: text(e.l3, 80), theme: text(e.theme, 40), desc: text(e.desc, 600), kw: words(e.kw, 40) }) },
  suppliers: { max: 5000, clean: (e) => ({ name: text(e.name, 120), preferred_l4: codes(e.preferred_l4) }) },
  contracts: { max: 2000, clean: (e) => ({ id: text(e.id, 40), supplier: text(e.supplier, 120), title: text(e.title, 160), l4: codes(e.l4), expires: text(e.expires, 10), remaining: num(e.remaining) }) },
  catalogue: { max: 5000, clean: (e) => ({ id: text(e.id, 40), kind: text(e.kind, 10), name: text(e.name, 120), supplier: text(e.supplier, 120), l4: text(e.l4, 20), price: num(e.price), max_order: num(e.max_order), unit: text(e.unit, 30), kw: words(e.kw, 20) }) },
};
const reference = (doc) => Object.fromEntries(Object.entries(REF).map(([k, r]) => [k, (Array.isArray(doc[k]) ? doc[k] : SEED[k]).slice(0, r.max).filter((e) => e && typeof e === "object").map(r.clean)]));

// -> a clean document, or null when the request is not a configuration at all
function sanitize(doc) {
  if (!doc || typeof doc !== "object" || !["params", "channels", "categories", "rules"].every((k) => Array.isArray(doc[k]))) return null;
  const by = (list, key) => new Map(list.filter((x) => x && typeof x === "object").map((x) => [x[key], x]));
  const params = by(doc.params, "key"), channels = by(doc.channels, "key"), categories = by(doc.categories, "id"), rules = by(doc.rules, "id");
  const questions = by(Array.isArray(doc.questions) ? doc.questions : [], "key"), guidance = by(Array.isArray(doc.guidance) ? doc.guidance : [], "key");
  const divisions = by(Array.isArray(doc.divisions) ? doc.divisions : [], "id"), lists = by(Array.isArray(doc.lists) ? doc.lists : [], "key");
  const nextSteps = by(Array.isArray(doc.next_steps) ? doc.next_steps : [], "key"), entities = by(Array.isArray(doc.entities) ? doc.entities : [], "id"), domains = by(Array.isArray(doc.domains) ? doc.domains : [], "id");
  const catIds = new Set(["_", ...SEED.categories.map((c) => c.id)]);
  return {
    params: SEED.params.map((p) => { const v = (params.get(p.key) || {}).value; return { ...p, value: typeof v === "number" && isFinite(v) && v >= 0 && v <= 1e12 ? v : p.value }; }),
    channels: SEED.channels.map((c) => {
      const x = channels.get(c.key) || {};
      const out = { ...c, name: text(x.name, 60, c.name) || c.name, days: text(x.days, 20, c.days) || c.days, lead_days: int(x.lead_days, 0, 365, c.lead_days) };
      if ("short_days" in c) Object.assign(out, { short_days: text(x.short_days, 20, c.short_days) || c.short_days, short_lead_days: int(x.short_lead_days, 0, 365, c.short_lead_days) });
      return out;
    }),
    categories: SEED.categories.map((c) => { const x = categories.get(c.id) || {}; return { id: c.id, name: text(x.name, 80, c.name) || c.name, cm_mandatory: x.cm_mandatory === true, renewals_calendar: x.renewals_calendar === true, keywords: Array.isArray(x.keywords) ? words(x.keywords) : [...c.keywords] }; }),
    facts: structuredClone(SEED.facts),
    rules: SEED.rules.map((r) => rule(r, rules.get(r.id))),
    // a question's texts can be changed only where the code asks it the same way every time (the seed has them)
    questions: SEED.questions.map((q) => {
      const x = questions.get(q.key) || {}, out = { key: q.key, label: text(x.label, 80) || q.label };
      if ("q" in q) out.q = text(x.q, 400) || q.q;
      // an example can be added to any question; an empty one shows none
      const ex = typeof x.ex === "string" ? text(x.ex, 400) : q.ex;
      if (ex) out.ex = ex;
      if ("why" in q) out.why = typeof x.why === "string" ? text(x.why, 400) : q.why;
      // which divisions are asked: R required, C conditional (asked for new demand), - not asked
      // answer buttons: only for questions whose answer the code records and never reads
      if (q.choices) { const c = (Array.isArray(x.choices) ? x.choices : q.choices).slice(0, 6).map((v) => text(v, 60)).filter(Boolean); out.choices = c.length ? c : [...q.choices]; }
      if (q.applies) out.applies = Object.fromEntries(SEED.divisions.map((d) => { const v = x.applies && x.applies[d.id]; return [d.id, ["R", "C", "-"].includes(v) ? v : q.applies[d.id] || "R"]; }));
      return out;
    }),
    // guidance texts per category; "_" is the text for any other category
    guidance: SEED.guidance.map((g) => {
      const x = guidance.get(g.key) || {}, sent = x.texts && typeof x.texts === "object" && !Array.isArray(x.texts) ? x.texts : g.texts;
      const texts = {};
      for (const [k, v] of Object.entries(sent)) if (catIds.has(k)) { const t = text(v, 600); if (t) texts[k] = t; }
      if ("_" in g.texts && !texts._) texts._ = g.texts._;
      return { ...g, categories: [...g.categories], texts: Object.fromEntries(Object.keys(texts).sort((a, b) => (a === "_" ? -1 : b === "_" ? 1 : a.localeCompare(b))).map((k) => [k, texts[k]])) };
    }),
    ...reference(doc),
    divisions: SEED.divisions.map((d) => { const x = divisions.get(d.id) || {}; return { id: d.id, name: text(x.name, 80) || d.name, vendor_office: text(x.vendor_office, 100) || d.vendor_office }; }),
    // next steps per channel: 1 to 5 texts; which placeholders each fills is set by the code
    next_steps: SEED.next_steps.map((n) => { const x = nextSteps.get(n.key) || {}, steps = (Array.isArray(x.steps) ? x.steps : n.steps).slice(0, 5).map((t) => text(t, 300)).filter(Boolean); return { ...n, steps: steps.length ? steps : [...n.steps] }; }),
    // legal entities: the ids are fixed (the code reads EU for the data transfer check); short codes match in capitals only
    entities: SEED.entities.map((e) => { const x = entities.get(e.id) || {};
      return { id: e.id, name: text(x.name, 80) || e.name, country: text(x.country, 60) || e.country, keywords: Array.isArray(x.keywords) ? words(x.keywords, 30) : [...e.keywords],
        codes: Array.isArray(x.codes) ? [...new Set(x.codes.map((c) => text(String(c), 6).replace(/[^A-Za-z]/g, "")).filter((c) => c.length >= 2))].slice(0, 6) : [...e.codes] }; }),
    // operations domains: search words and the guidance texts; the ids and which are operations domains are fixed
    domains: SEED.domains.map((d) => { const x = domains.get(d.id) || {}, out = { id: d.id, ops: d.ops, name: text(x.name, 80) || d.name, keywords: Array.isArray(x.keywords) ? words(x.keywords, 40) : [...d.keywords] };
      for (const k of DOMAIN_TEXTS) if (k in d) out[k] = typeof x[k] === "string" ? text(x[k], 600) || (k === "important" ? null : d[k]) : x[k] === null && k === "important" ? null : d[k];
      return out; }),
    // the welcome screen's examples
    examples: (Array.isArray(doc.examples) ? doc.examples : SEED.examples).slice(0, 12).filter((e) => e && typeof e === "object").map((e) => ({ group: text(e.group, 40), label: text(e.label, 40), text: text(e.text, 300) })).filter((e) => e.text && e.label),
    // review lists: entries with a name and search words ("word", or "stem*" for longer words too)
    lists: SEED.lists.map((l) => {
      const x = lists.get(l.key) || {}, items = Array.isArray(x.items) ? x.items : l.items;
      return { ...l, items: items.slice(0, 200).filter((it) => it && typeof it === "object").map((it) => ({
        name: text(it.name, 80),
        keywords: (Array.isArray(it.keywords) ? it.keywords : []).slice(0, 20).map((k) => text(k, 40).toLowerCase().replace(/[^a-z0-9 *'&-]/g, "").replace(/\*(?!$)/g, "").trim()).filter((k) => k.replace("*", "").length >= 2),
      })).filter((it) => it.name && it.keywords.length) };
    }),
  };
}

module.exports = { sanitize, text };
