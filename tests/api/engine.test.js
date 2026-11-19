// The decision-table engine and the seed: operators, first match wins, unknown facts, validation, and every rule's own test cases.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const Engine = require("../../engine.js");
const { buildConfig, validateConfig } = require("../../scripts/build_defaults.js");

const cfg = buildConfig();
const params = Object.fromEntries(cfg.params.map((p) => [p.key, p.value]));
const registry = Object.fromEntries(cfg.facts.map((f) => [f.key, f]));
const rule = (id) => cfg.rules.find((r) => r.id === id);

test("operators compare as written, and a threshold is read from the parameters", () => {
  const h = (fact, op, value, facts) => Engine.holds({ fact, op, value }, facts, { limit: 100 });
  assert.equal(h("a", "is", "x", { a: "x" }), true);
  assert.equal(h("a", "is", true, { a: "true" }), false);   // no loose typing
  assert.equal(h("a", "is_not", "x", { a: "y" }), true);
  assert.equal(h("a", "in", ["x", "y"], { a: "y" }), true);
  assert.equal(h("n", "gte", { param: "limit" }, { n: 100 }), true);
  assert.equal(h("n", "gte", { param: "limit" }, { n: 99 }), false);
  assert.equal(h("n", "gt", 100, { n: 100 }), false);
  assert.equal(h("n", "lte", 100, { n: 100 }), true);
  assert.equal(h("n", "lt", 100, { n: 100 }), false);
  assert.equal(h("a", "is_known", null, { a: 0 }), true);
  assert.equal(h("a", "is_unknown", null, { a: "" }), true);
});

test("a comparison on an unknown fact is false, so an unknown value never counts as small", () => {
  for (const op of ["is", "is_not", "in", "gte", "gt", "lte", "lt"]) assert.equal(Engine.holds({ fact: "n", op, value: 5 }, { n: null }, {}), false, op);
  assert.equal(Engine.evaluate(rule("R11"), { value_known: null, annual_value: null }, params).outcome, "division");   // only the "otherwise" row holds
  assert.equal(Engine.evaluate(rule("R11"), { value_known: false }, params).outcome, "pending_value");
});

test("the first matching row wins and the result names the rule, the row and the outcome's attributes", () => {
  const d = Engine.evaluate(rule("R11"), { cat_renewals_calendar: false, request_type: "new", value_known: true, annual_value: 250000, cat_cm_mandatory: false }, params);
  assert.deepEqual({ rule: d.rule, row: d.row, outcome: d.outcome }, { rule: "R11", row: 5, outcome: "cm_decides" });
  assert.deepEqual({ lead: d.attrs.lead, status: d.attrs.status, form: d.attrs.form }, { lead: "category_manager", status: "pending_category_manager", form: true });
  assert.match(d.text, /Category Manager decides/);
  assert.equal(Engine.evaluate({ id: "X", rows: [] }, {}, {}).row, 0);
});

test("a changed threshold or a changed row order changes the outcome", () => {
  const facts = { cat_renewals_calendar: false, request_type: "new", value_known: true, annual_value: 250000, cat_cm_mandatory: false };
  assert.equal(Engine.evaluate(rule("R11"), facts, { ...params, leadMin: 200000 }).outcome, "lead_threshold");
  assert.equal(Engine.evaluate(rule("R11"), facts, { ...params, formMin: 300000 }).outcome, "division");
  const r = structuredClone(rule("R11")); r.rows.splice(2, 2);   // without the upper threshold and the mandatory row
  assert.equal(Engine.evaluate(r, { ...facts, annual_value: 900000 }, params).outcome, "cm_decides");
});

test("fill replaces known placeholders and leaves a misspelt one visible", () => {
  assert.equal(Engine.fill("At {amount} under {limit}; {typo}", { amount: "€5", limit: "€10" }), "At €5 under €10; {typo}");
});

test("every rule in the seed is valid and passes its own test cases", () => {
  assert.deepEqual(validateConfig(cfg), []);
  for (const r of cfg.rules) {
    assert.ok(r.tests.length >= 2, `${r.id} has test cases`);
    for (const t of Engine.runTests(r, params)) assert.ok(t.ok, `${r.id}: ${t.name} → ${t.got}, expected ${t.expect}`);
  }
  assert.deepEqual(cfg.rules.map((r) => r.id), ["R01", "R02", "R11", "R19", "R07", "R08", ...Array.from({ length: 24 }, (_, i) => `R${20 + i}`)]);
});

test("every review flag has a title, a level and a reviewer, and every flag rule has an \"otherwise\" row with no flag", () => {
  const flagRules = cfg.rules.filter((r) => r.outcomes.some((o) => o.flag));
  assert.equal(flagRules.length, 26);
  for (const r of flagRules) {
    for (const o of r.outcomes.filter((x) => x.flag)) {
      assert.ok(o.title && ["i", "w", "b"].includes(o.level) && o.owner, `${r.id} ${o.key}: title, level and reviewer`);
    }
    assert.ok(!r.outcomes.find((o) => o.key === r.rows.at(-1).then).flag, `${r.id}: the otherwise row raises no flag`);
    assert.ok(r.clause, `${r.id}: names the policy it rests on`);
    assert.ok(r.tests.some((t) => r.outcomes.find((o) => o.key === t.expect).flag) && r.tests.some((t) => !r.outcomes.find((o) => o.key === t.expect).flag), `${r.id}: tests both ways`);
  }
});

test("validation names what is wrong with a rule in plain words", () => {
  const bad = { id: "RX", outcomes: [{ key: "a" }], rows: [
    { when: [{ fact: "annual_value", op: "is_one_of", value: 1 }], then: "a" },
    { when: [{ fact: "nope", op: "is", value: 1 }], then: "a" },
    { when: [{ fact: "annual_value", op: "in", value: [1] }], then: "a" },
    { when: [{ fact: "annual_value", op: "gte", value: { param: "missing" } }], then: "a" },
    { when: [{ fact: "request_type", op: "is", value: "sideways" }], then: "b" },
    { when: [], then: "a" },
    { when: [{ fact: "value_known", op: "is", value: "yes" }], then: "a" }], tests: [{ name: "t", given: {}, expect: "zzz" }] };
  const errors = Engine.validateRule(bad, registry, params).join("\n");
  for (const part of ['unknown operator "is_one_of"', 'unknown fact "nope"', '"is one of" does not fit annual_value', 'unknown threshold "missing"', '"sideways" is not a value of request_type',
    'outcome "b" is not one of the rule\'s outcomes', "row 6 has no conditions, so the rows below it can never apply", 'the last row must be the "otherwise" row', "value_known needs true or false", 'expects "zzz"'])
    assert.ok(errors.includes(part), `missing: ${part}\n${errors}`);
});

test("the built-in defaults in index.html are the seed", () => {
  execFileSync(process.execPath, [path.join(__dirname, "../../scripts/build_defaults.js"), "--check"], { stdio: "pipe" });
});
