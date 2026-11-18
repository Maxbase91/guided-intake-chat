/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
/* Decision-table engine. One implementation for the page, the admin page and the server.

   A rule is data:
     { id, name, outcomes:[{key, label, ...attributes}], rows:[{when:[condition], then:"outcome key", text?}], tests:[{name, given, expect}] }
   A condition is { fact, op, value }. The value is a literal, a list (for "in") or { param:"name" }, which reads a
   threshold from the parameters. Conditions in a row are ANDed; the first row whose conditions all hold gives the
   outcome. A row without conditions always holds, so the last row is the "otherwise" row.
   A comparison on a fact that is not known is false: an unknown value never matches "under 100,000". */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const isKnown = (v) => v !== null && v !== undefined && v !== "";
  const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : NaN);

  // label for the admin page; types the operator accepts; needs a value
  const OPS = {
    is:         { label: "is",              types: ["enum", "bool", "number", "text"], value: true },
    is_not:     { label: "is not",          types: ["enum", "bool", "number", "text"], value: true },
    in:         { label: "is one of",       types: ["enum", "text"],                   value: true },
    gte:        { label: "is at least",     types: ["number"],                         value: true },
    gt:         { label: "is more than",    types: ["number"],                         value: true },
    lte:        { label: "is at most",      types: ["number"],                         value: true },
    lt:         { label: "is less than",    types: ["number"],                         value: true },
    is_known:   { label: "is known",        types: ["enum", "bool", "number", "text"], value: false },
    is_unknown: { label: "is not known",    types: ["enum", "bool", "number", "text"], value: false },
  };

  function resolve(value, params) {
    if (value && typeof value === "object" && !Array.isArray(value) && "param" in value) return params ? params[value.param] : undefined;
    return value;
  }

  function holds(cond, facts, params) {
    const have = facts ? facts[cond.fact] : undefined;
    if (cond.op === "is_known") return isKnown(have);
    if (cond.op === "is_unknown") return !isKnown(have);
    if (!isKnown(have)) return false;
    const want = resolve(cond.value, params);
    switch (cond.op) {
      case "is":     return have === want;
      case "is_not": return have !== want;
      case "in":     return Array.isArray(want) && want.includes(have);
      case "gte":    return num(have) >= num(want);
      case "gt":     return num(have) > num(want);
      case "lte":    return num(have) <= num(want);
      case "lt":     return num(have) < num(want);
    }
    return false;
  }

  // -> { rule, row (1-based position, 0 when no row matched), outcome, attrs (the outcome's attributes), text }
  function evaluate(rule, facts, params) {
    const rows = (rule && rule.rows) || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if ((row.when || []).every((c) => holds(c, facts, params))) {
        const attrs = ((rule.outcomes || []).find((o) => o.key === row.then)) || { key: row.then };
        return { rule: rule.id, row: i + 1, outcome: row.then, attrs, text: row.text || "" };
      }
    }
    return { rule: rule ? rule.id : null, row: 0, outcome: null, attrs: {}, text: "" };
  }

  // "{name}" placeholders; an unknown name stays visible so a typo in a template is noticed
  function fill(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, (m, k) => (values && isKnown(values[k]) ? String(values[k]) : m));
  }

  // a test case can name a threshold instead of a number, so it follows the threshold when that changes:
  // { param: "formMin" } is the threshold itself, { param: "formMin", plus: -1 } is just under it
  function given(g, params) {
    return Object.fromEntries(Object.entries(g || {}).map(([k, v]) => [k, v && typeof v === "object" && "param" in v ? Number(params ? params[v.param] : NaN) + (Number(v.plus) || 0) : v]));
  }
  function runTests(rule, params) {
    return ((rule && rule.tests) || []).map((t) => {
      const got = evaluate(rule, given(t.given, params), params).outcome;
      return { name: t.name, expect: t.expect, got, ok: got === t.expect };
    });
  }

  // registry: { factKey: { type: "enum"|"bool"|"number"|"text", values?: [...] } }; params: { name: number }
  function validateRule(rule, registry, params) {
    const errors = [], say = (m) => errors.push(`${rule && rule.id ? rule.id : "rule"}: ${m}`);
    if (!rule || !rule.id) return ["rule: no id"];
    const outcomes = new Set((rule.outcomes || []).map((o) => o.key));
    if (!outcomes.size) say("no outcomes");
    const rows = rule.rows || [];
    if (!rows.length) say("no rows");
    rows.forEach((row, i) => {
      const at = `row ${i + 1}`;
      if (!outcomes.has(row.then)) say(`${at}: outcome "${row.then}" is not one of the rule's outcomes`);
      (row.when || []).forEach((c) => {
        const op = OPS[c.op], fact = registry ? registry[c.fact] : null;
        if (!op) return say(`${at}: unknown operator "${c.op}"`);
        if (registry && !fact) return say(`${at}: unknown fact "${c.fact}"`);
        if (fact && !op.types.includes(fact.type)) say(`${at}: "${op.label}" does not fit ${c.fact} (${fact.type})`);
        if (!op.value) return;
        if (c.value && typeof c.value === "object" && !Array.isArray(c.value) && "param" in c.value) {
          if (params && !(c.value.param in params)) say(`${at}: unknown threshold "${c.value.param}"`);
          return;
        }
        if (c.op === "in" && !Array.isArray(c.value)) return say(`${at}: "is one of" needs a list`);
        if (!isKnown(c.value) && c.value !== false) return say(`${at}: ${c.fact} ${op.label}: no value`);
        if (fact && fact.type === "number" && isNaN(num(c.value))) say(`${at}: ${c.fact} needs a number`);
        if (fact && fact.type === "bool" && typeof c.value !== "boolean") say(`${at}: ${c.fact} needs true or false`);
        if (fact && fact.type === "enum" && fact.values) {
          const list = Array.isArray(c.value) ? c.value : [c.value];
          list.filter((v) => !fact.values.includes(v)).forEach((v) => say(`${at}: "${v}" is not a value of ${c.fact}`));
        }
      });
    });
    if (rows.length && (rows[rows.length - 1].when || []).length) say('the last row must be the "otherwise" row, without conditions');
    rows.slice(0, -1).forEach((row, i) => { if (!(row.when || []).length) say(`row ${i + 1} has no conditions, so the rows below it can never apply`); });
    (rule.tests || []).forEach((t) => { if (!outcomes.has(t.expect)) say(`test "${t.name}": expects "${t.expect}", which is not an outcome`); });
    (rule.tests || []).forEach((t) => Object.entries(t.given || {}).forEach(([k, v]) => {
      if (registry && !registry[k]) say(`test "${t.name}": unknown fact "${k}"`);
      if (v && typeof v === "object" && params && !(v.param in params)) say(`test "${t.name}": unknown threshold "${v.param}"`);
    }));
    return errors;
  }

  return { OPS, holds, evaluate, fill, given, runTests, validateRule };
});
