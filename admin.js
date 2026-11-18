/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
/* The admin page: thresholds, channels, category flags and the decision tables, edited as a draft and published as a
   new version. Everything is built with DOM nodes and textContent, never innerHTML, so nothing typed here or read from
   the database can become markup. The rules are checked in the browser with the same engine the page and the server run. */
(function () {
  "use strict";
  const $app = document.getElementById("app");
  const S = { code: sessionStorage.getItem("adm") || "", actor: localStorage.getItem("adm-name") || "", st: null, doc: null, tab: "thresholds", unsaved: false, extra: {}, busy: false, qFilter: "", gKey: "" };
  const TABS = [["thresholds", "Thresholds"], ["channels", "Channels"], ["categories", "Categories"], ["rules", "Rules"], ["questions", "Questions"], ["guidance", "Guidance"], ["versions", "Versions and changes"], ["decisions", "Decision log"]];

  // ---------- small helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const num = (v) => new Intl.NumberFormat("en-GB").format(v);
  const when = (t) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const paramsOf = (doc) => Object.fromEntries(doc.params.map((p) => [p.key, p.value]));
  const registryOf = (doc) => Object.fromEntries(doc.facts.map((f) => [f.key, f]));
  const paramLabel = (doc, key) => { const p = doc.params.find((x) => x.key === key); return p ? `${p.label} (${num(p.value)})` : key; };
  function toast(msg) { const t = h("div", { class: "toast", role: "status" }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
  function select(options, value, onchange, attrs) {   // options: [[value, label]]
    const el = h("select", { ...attrs, onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h("option", { value: v }, l)));
    el.value = value === undefined || value === null ? "" : String(value);
    return el;
  }

  // ---------- server
  async function api(method, body, query) {
    const r = await fetch("/api/admin" + (query ? "?" + new URLSearchParams(query) : ""), { method, headers: { "x-admin-code": S.code, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw Object.assign(new Error((data && data.error) || `The server answered ${r.status}.`), { status: r.status, code: data && data.code, problems: data && data.problems });
    return data;
  }
  function take(st) { S.st = st; S.doc = clone(st.draft); S.unsaved = false; }
  async function act(fn, done) {
    if (S.busy) return; S.busy = true; render();
    try { const out = await fn(); if (out) take(out); if (done) toast(done); }
    catch (e) {
      if (e.status === 401) { S.code = ""; sessionStorage.removeItem("adm"); S.st = null; }
      S.error = e.problems ? `${e.message} ${e.problems.join("; ")}` : e.message;
    }
    S.busy = false; render();
  }
  const save = () => act(() => api("POST", { action: "save", doc: S.doc, revision: S.st.revision, actor: S.actor }), "Draft saved");

  // ---------- local checks: the same validation the server runs before it publishes
  function problems() {
    const out = [], doc = S.doc, params = paramsOf(doc), registry = registryOf(doc);
    doc.params.forEach((p) => { if (typeof p.value !== "number" || !isFinite(p.value) || p.value < 0) out.push(`${p.label}: not a number of 0 or more`); });
    if (params.formMin > params.leadMin) out.push("The sourcing request form threshold is above the threshold from which procurement leads.");
    doc.channels.forEach((c) => { if (!String(c.name || "").trim()) out.push(`Channel ${c.key} has no name`); });
    doc.rules.forEach((rule) => {
      out.push(...Engine.validateRule(rule, registry, params));
      Engine.runTests(rule, params).filter((t) => !t.ok).forEach((t) => out.push(`${rule.id}: test "${t.name}" expects ${t.expect}, got ${t.got}`));
    });
    return out;
  }
  function edit(fn) { fn(); S.unsaved = !same(S.doc, S.st.draft); S.error = ""; render(); }
  // an edit inside a text field: keep typing without a re-render, refresh the status bar only
  function editQuiet(fn) { fn(); S.unsaved = !same(S.doc, S.st.draft); S.error = ""; const bar = document.getElementById("statusbar"); if (bar) bar.replaceWith(statusBar()); }

  // A field's "change" fires when it loses focus, which is also the moment a button is pressed. Re-rendering then would
  // replace the button under the pointer and swallow the click, so the re-render waits until the mouse is released.
  let mouseDown = false, pending = false;
  function later() { if (mouseDown) pending = true; else render(); }
  document.addEventListener("mousedown", () => { mouseDown = true; }, true);
  document.addEventListener("mouseup", () => { mouseDown = false; if (pending) { pending = false; setTimeout(render, 0); } }, true);

  // ---------- sign-in
  function login() {
    const code = h("input", { type: "password", id: "code", autocomplete: "current-password", value: S.code });
    const name = h("input", { type: "text", id: "name", maxlength: "60", value: S.actor, placeholder: "Shown in the change log" });
    const err = h("div", { class: "err", role: "alert" }, S.error || "");
    const go = async (e) => {
      e.preventDefault(); S.code = code.value; S.actor = name.value.trim(); S.error = "";
      try { take(await api("GET")); sessionStorage.setItem("adm", S.code); localStorage.setItem("adm-name", S.actor); }
      catch (x) { S.error = x.message; S.st = null; }
      render();
    };
    return h("form", { class: "login", onsubmit: go },
      h("h1", {}, "Rules and settings"), h("p", { class: "hint" }, "Sign in with the admin code. Changes are saved as a draft and go live only when you publish them."),
      h("label", { for: "code" }, "Admin code"), code, h("label", { for: "name" }, "Your name"), name, err,
      h("p", {}, h("button", { class: "btn p", type: "submit" }, "Sign in")));
  }

  // ---------- status bar
  function statusBar() {
    const st = S.st, prob = problems();
    const dirty = st.dirty || S.unsaved;
    return h("div", { class: "status", id: "statusbar" },
      h("span", { class: "pill ok" }, `Published: version ${st.published_version}`),
      h("span", { class: `pill ${dirty ? "warn" : ""}` }, S.unsaved ? "Unsaved changes" : st.dirty ? "Draft differs from the published version" : "No changes"),
      h("span", { class: `pill ${prob.length ? "bad" : "ok"}`, id: "probpill" }, prob.length ? `${prob.length} problem${prob.length > 1 ? "s" : ""}` : "All rules pass their tests"),
      h("span", { class: "muted" }, st.store === "memory" ? "No database: changes last until the server restarts." : `Draft last saved ${when(st.updated_at)} by ${st.updated_by}`),
      h("span", { style: "flex:1" }),
      h("button", { class: "btn", id: "saveBtn", disabled: !S.unsaved || S.busy, onclick: save }, "Save draft"),
      h("button", { class: "btn", id: "discardBtn", disabled: !(st.dirty || S.unsaved) || S.busy, onclick: () => { if (confirm("Discard all changes since the published version?")) act(() => api("POST", { action: "discard", revision: S.st.revision, actor: S.actor }), "Draft reset to the published version"); } }, "Discard changes"),
      h("button", { class: "btn a", id: "publishBtn", disabled: S.unsaved || !st.dirty || prob.length > 0 || S.busy, title: S.unsaved ? "Save the draft first" : prob.length ? "Fix the problems first" : "", onclick: publish }, "Publish…"));
  }
  function publish() {
    const note = prompt(`Publish the draft as version ${S.st.published_version + 1}?\nNew conversations use it within a minute.\n\nWhat changed (shown in the version list):`, "");
    if (note === null) return;
    act(() => api("POST", { action: "publish", revision: S.st.revision, note, actor: S.actor }), "Published");
  }

  // ---------- tabs
  const changed = (part, key, field) => { const id = part === "categories" || part === "rules" ? "id" : "key"; const a = S.st.draft[part].find((x) => x[id] === key), b = S.doc[part].find((x) => x[id] === key); return a && b && !same(a[field], b[field]) ? "changed" : ""; };

  function thresholds() {
    return h("div", { class: "card" }, h("h2", {}, "Thresholds"), h("p", { class: "hint" }, "Amounts are in euros. The rules read these values by name, so a change here changes every rule that uses the threshold."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Threshold"), h("th", {}, "Value"), h("th", {}, "Unit"), h("th", {}, "Effect"))),
        h("tbody", {}, S.doc.params.map((p) => h("tr", {},
          h("td", {}, h("label", { for: "p-" + p.key }, h("b", {}, p.label))),
          h("td", {}, h("input", { type: "number", id: "p-" + p.key, min: "0", step: "1", class: changed("params", p.key, "value"), value: p.value, oninput: (e) => editQuiet(() => { p.value = e.target.value === "" ? NaN : Number(e.target.value); }), onchange: later })),
          h("td", { class: "muted" }, p.unit), h("td", { class: "muted" }, p.description))))));
  }

  function channels() {
    const field = (c, f, type, w) => h("input", { type, id: `c-${c.key}-${f}`, "aria-label": `${c.key} ${f}`, style: w ? `width:${w}px` : "", class: changed("channels", c.key, f), value: c[f],
      oninput: (e) => editQuiet(() => { c[f] = type === "number" ? (e.target.value === "" ? 0 : Math.round(Number(e.target.value))) : e.target.value; }), onchange: later });
    return h("div", { class: "card" }, h("h2", {}, "Buying channels"), h("p", { class: "hint" }, "There are four channels. You can change how they are named and how long they usually take. \"Tight under\" is the number of days below which a start date gets a warning."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Channel"), h("th", {}, "Name shown to the requester"), h("th", {}, "Typical working days"), h("th", {}, "Tight under (days)"))),
        h("tbody", {}, S.doc.channels.flatMap((c) => [h("tr", {}, h("td", { class: "muted" }, c.key), h("td", {}, field(c, "name", "text", 280)), h("td", {}, field(c, "days", "text", 110)), h("td", {}, field(c, "lead_days", "number"))),
          "short_days" in c ? h("tr", {}, h("td", { class: "muted" }, "↳ small purchase"), h("td", { class: "muted" }, "Same channel, short form"), h("td", {}, field(c, "short_days", "text", 110)), h("td", {}, field(c, "short_lead_days", "number"))) : null]))));
  }

  function categories() {
    const box = (c, f, label) => h("input", { type: "checkbox", id: `cat-${c.id}-${f}`, "aria-label": `${c.name}: ${label}`, checked: c[f], onchange: (e) => edit(() => { c[f] = e.target.checked; }) });
    return h("div", { class: "card" }, h("h2", {}, "Categories"), h("p", { class: "hint" }, "Two flags per category are read by the who-leads rule. Mandatory: between the two thresholds procurement leads instead of the Category Manager deciding. Renewals calendar: a renewal in this category goes to procurement without a sourcing request form."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Category Manager mandatory"), h("th", {}, "Renewals calendar"))),
        h("tbody", {}, S.doc.categories.map((c) => h("tr", { class: changed("categories", c.id, "cm_mandatory") || changed("categories", c.id, "renewals_calendar") },
          h("td", {}, h("input", { type: "text", "aria-label": `Name of ${c.id}`, style: "width:300px", class: changed("categories", c.id, "name"), value: c.name, oninput: (e) => editQuiet(() => { c.name = e.target.value; }) }), " ", h("span", { class: "muted" }, c.id)),
          h("td", {}, box(c, "cm_mandatory", "Category Manager mandatory")), h("td", {}, box(c, "renewals_calendar", "renewals calendar")))))));
  }

  // ---------- rules: a decision table as sentences
  function valueControl(rule, cond, fact) {
    const op = Engine.OPS[cond.op];
    if (!op || !op.value || !fact) return null;
    if (fact.type === "bool") return select([["true", "yes"], ["false", "no"]], String(cond.value === true), (v) => edit(() => { cond.value = v === "true"; }), { "aria-label": "value" });
    if (fact.type === "enum" && cond.op === "in") {
      const list = Array.isArray(cond.value) ? cond.value : [];
      return h("span", { class: "checks" }, fact.values.map((v) => h("label", {}, h("input", { type: "checkbox", checked: list.includes(v), onchange: (e) => edit(() => { cond.value = e.target.checked ? [...list, v] : list.filter((x) => x !== v); }) }), " ", v)));
    }
    if (fact.type === "enum") return select(fact.values.map((v) => [v, v]), cond.value, (v) => edit(() => { cond.value = v; }), { "aria-label": "value" });
    if (fact.type === "number") {
      const isParam = cond.value && typeof cond.value === "object";
      const pick = select([...S.doc.params.map((p) => ["p:" + p.key, "the threshold: " + paramLabel(S.doc, p.key)]), ["n", "a fixed number"]], isParam ? "p:" + cond.value.param : "n",
        (v) => edit(() => { cond.value = v === "n" ? 0 : { param: v.slice(2) }; }), { "aria-label": "compare with" });
      return isParam ? pick : h("span", {}, pick, " ", h("input", { type: "number", "aria-label": "number", value: cond.value, oninput: (e) => editQuiet(() => { cond.value = Number(e.target.value); }), onchange: later }));
    }
    return h("input", { type: "text", "aria-label": "value", value: Array.isArray(cond.value) ? cond.value.join(", ") : cond.value ?? "", oninput: (e) => editQuiet(() => { cond.value = cond.op === "in" ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : e.target.value; }), onchange: later });
  }
  function defaultValue(fact, op) {
    if (!Engine.OPS[op].value) return undefined;
    if (fact.type === "bool") return true;
    if (fact.type === "enum") return op === "in" ? [fact.values[0]] : fact.values[0];
    if (fact.type === "number") return { param: S.doc.params[0].key };
    return op === "in" ? [] : "";
  }
  function conditionLine(rule, row, ci) {
    const cond = row.when[ci], registry = registryOf(S.doc), fact = registry[cond.fact];
    const ops = Object.entries(Engine.OPS).filter(([, o]) => !fact || o.types.includes(fact.type));
    return h("div", { class: "line" }, h("span", { class: "kw" }, ci === 0 ? "IF" : "AND"),
      select(S.doc.facts.map((f) => [f.key, f.label]), cond.fact, (v) => edit(() => { const f = registry[v]; cond.fact = v; if (!Engine.OPS[cond.op] || !Engine.OPS[cond.op].types.includes(f.type)) cond.op = f.type === "number" ? "gte" : "is"; const d = defaultValue(f, cond.op); if (d === undefined) delete cond.value; else cond.value = d; }), { "aria-label": "fact", style: "max-width:360px" }),
      select(ops.map(([k, o]) => [k, o.label]), cond.op, (v) => edit(() => { const wasList = cond.op === "in"; cond.op = v; if (!Engine.OPS[v].value) delete cond.value; else if (cond.value === undefined || (v === "in") !== wasList) cond.value = defaultValue(fact, v); }), { "aria-label": "comparison" }),
      valueControl(rule, cond, fact),
      h("button", { class: "btn s x", type: "button", title: "Remove this condition", "aria-label": "Remove this condition", onclick: () => edit(() => { row.when.splice(ci, 1); }) }, "✕"));
  }
  function ruleRow(rule, i) {
    const row = rule.rows[i], last = i === rule.rows.length - 1, movable = rule.rows.length - 1;   // the otherwise row stays last
    const move = (d) => edit(() => { const [x] = rule.rows.splice(i, 1); rule.rows.splice(i + d, 0, x); });
    return h("div", { class: "row" + (last ? " else" : ""), "data-row": String(i + 1) },
      h("div", { class: "line" }, h("span", { class: "rownum" }, `${i + 1}.`), last ? h("span", { class: "kw", style: "min-width:auto" }, "OTHERWISE") : null, h("span", { style: "flex:1" }),
        last ? null : [h("button", { class: "btn s", type: "button", disabled: i === 0, title: "Move up: checked earlier", "aria-label": `Move row ${i + 1} up`, onclick: () => move(-1) }, "↑"),
          h("button", { class: "btn s", type: "button", disabled: i >= movable - 1, title: "Move down: checked later", "aria-label": `Move row ${i + 1} down`, onclick: () => move(1) }, "↓"),
          h("button", { class: "btn s x", type: "button", "aria-label": `Delete row ${i + 1}`, onclick: () => { if (confirm(`Delete row ${i + 1}?`)) edit(() => { rule.rows.splice(i, 1); }); } }, "Delete row")]),
      last ? null : row.when.map((_, ci) => conditionLine(rule, row, ci)),
      last ? null : h("div", { class: "line" }, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { const f = S.doc.facts[0]; row.when.push({ fact: f.key, op: "is", value: defaultValue(f, "is") }); }) }, "+ condition")),
      h("div", { class: "line" }, h("span", { class: "kw" }, "THEN"), select(rule.outcomes.map((o) => [o.key, o.label]), row.then, (v) => edit(() => { row.then = v; }), { "aria-label": `Outcome of row ${i + 1}` })),
      "text" in row || (rule.placeholders || []).length ? h("div", {}, h("div", { class: "muted", style: "margin-top:4px" }, `What the requester is told.${(rule.placeholders || []).length ? " Placeholders: " + rule.placeholders.map((x) => `{${x}}`).join(" ") : ""}`),
        h("textarea", { "aria-label": `Reason text of row ${i + 1}`, oninput: (e) => editQuiet(() => { if (e.target.value) row.text = e.target.value; else delete row.text; }) }, row.text || "")) : null);
  }
  // one test case: the facts it sets, and the outcome it expects
  function givenControl(rule, t, fact) {
    const v = t.given[fact.key], set = (x) => edit(() => { if (x === undefined) delete t.given[fact.key]; else t.given[fact.key] = x; });
    let control;
    if (fact.type === "bool") control = select([["", "–"], ["true", "yes"], ["false", "no"]], v === undefined ? "" : String(v), (x) => set(x === "" ? undefined : x === "true"));
    else if (fact.type === "enum") control = select([["", "–"], ...fact.values.map((x) => [x, x])], v ?? "", (x) => set(x === "" ? undefined : x));
    else if (fact.type === "number") {
      const rel = v && typeof v === "object", opts = [["", "–"], ["n", "number"], ...S.doc.params.filter((p) => /EUR/.test(p.unit)).flatMap((p) => [[`${p.key}|-1`, `just under ${num(p.value)}`], [`${p.key}|0`, `exactly ${num(p.value)}`], [`${p.key}|1`, `just over ${num(p.value)}`]])];
      const cur = v === undefined ? "" : rel ? `${v.param}|${v.plus || 0}` : "n";
      const pick = select(opts.some(([o]) => o === cur) ? opts : [...opts, [cur, cur]], cur, (x) => set(x === "" ? undefined : x === "n" ? 0 : (() => { const [param, plus] = x.split("|"); return Number(plus) ? { param, plus: Number(plus) } : { param }; })()));
      control = rel || v === undefined ? pick : h("span", {}, pick, h("input", { type: "number", "aria-label": fact.label, value: v, oninput: (e) => editQuiet(() => { t.given[fact.key] = Number(e.target.value); }), onchange: later }));
    } else control = h("input", { type: "text", value: v ?? "", oninput: (e) => editQuiet(() => { if (e.target.value) t.given[fact.key] = e.target.value; else delete t.given[fact.key]; }) });
    control.setAttribute && control.tagName === "SELECT" && control.setAttribute("aria-label", fact.label);
    return h("span", { class: "g", title: fact.label }, h("span", { class: "n" }, fact.label), control);
  }
  function tests(rule) {
    const registry = registryOf(S.doc), params = paramsOf(S.doc), results = Engine.runTests(rule, params);
    const used = [...new Set([...rule.rows.flatMap((r) => r.when.map((c) => c.fact)), ...rule.tests.flatMap((t) => Object.keys(t.given))])].map((k) => registry[k]).filter(Boolean);
    const label = (key) => (rule.outcomes.find((o) => o.key === key) || { label: key || "nothing" }).label;
    return h("details", { open: results.some((r) => !r.ok) }, h("summary", {}, `Test cases: ${results.filter((r) => r.ok).length} of ${results.length} pass`),
      h("p", { class: "hint" }, "Each test says: with these facts, the rule must give this outcome. A draft is published only when every test passes. \"Just under\" and \"just over\" follow the threshold when you change it."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Test"), h("th", {}, "Given"), h("th", {}, "Must give"), h("th", {}, "Result"), h("th", {}))),
        h("tbody", {}, rule.tests.map((t, i) => h("tr", { "data-test": t.name },
          h("td", {}, h("input", { type: "text", "aria-label": "Test name", style: "width:230px", value: t.name, oninput: (e) => editQuiet(() => { t.name = e.target.value; }) })),
          h("td", {}, h("div", { class: "given" }, used.map((f) => givenControl(rule, t, f)))),
          h("td", {}, select(rule.outcomes.map((o) => [o.key, o.label]), t.expect, (v) => edit(() => { t.expect = v; }), { "aria-label": "Expected outcome" })),
          h("td", { class: results[i].ok ? "pass" : "fail" }, results[i].ok ? "✓ passes" : `✗ gives: ${label(results[i].got)}`),
          h("td", {}, h("button", { class: "btn s x", type: "button", "aria-label": `Delete test ${t.name}`, onclick: () => edit(() => { rule.tests.splice(i, 1); }) }, "✕")))))),
      h("p", {}, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { rule.tests.push({ name: "New test", given: {}, expect: rule.outcomes[0].key }); }) }, "+ test case")));
  }
  function ruleCard(rule) {
    const text = (f, label, w) => h("label", { style: "display:block;margin:6px 0" }, h("span", { class: "muted" }, label), h("br"), h("input", { type: "text", style: `width:${w}`, class: changed("rules", rule.id, f), value: rule[f] || "", oninput: (e) => editQuiet(() => { rule[f] = e.target.value; }) }));
    const bad = Engine.validateRule(rule, registryOf(S.doc), paramsOf(S.doc));
    return h("div", { class: "card", id: "rule-" + rule.id, "data-rule": rule.id },
      h("div", { style: "display:flex;gap:10px;align-items:baseline;flex-wrap:wrap" }, h("h2", {}, `${rule.id}  ${rule.name}`), h("span", { class: "pill" }, rule.step), !same(rule, S.st.draft.rules.find((r) => r.id === rule.id)) ? h("span", { class: "pill warn" }, "changed") : null),
      h("p", { class: "hint" }, rule.decides),
      h("details", {}, h("summary", {}, "Name, source and mode"), text("name", "Name", "min(520px,100%)"), text("decides", "What it decides", "100%"), text("clause", "Rests on (policy and clause)", "100%"),
        h("label", { style: "display:block;margin:6px 0" }, h("span", { class: "muted" }, "Mode"), h("br"), select([["enforce", "Enforce: the outcome is binding"], ["advise", "Advise: a warning; the requester may continue with a reason"], ["inform", "Inform: shown only"]], rule.mode, (v) => edit(() => { rule.mode = v; })))),
      h("p", { class: "hint", style: "margin-top:10px" }, "The rows are checked from top to bottom. The first row whose conditions all hold gives the outcome."),
      bad.length ? h("div", { class: "problems" }, h("b", {}, "This rule has problems"), h("ul", {}, bad.map((b) => h("li", {}, b.replace(rule.id + ": ", ""))))) : null,
      rule.rows.map((_, i) => ruleRow(rule, i)),
      h("p", {}, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { const f = S.doc.facts[0]; rule.rows.splice(rule.rows.length - 1, 0, { when: [{ fact: f.key, op: "is", value: defaultValue(f, "is") }], then: rule.outcomes[0].key }); }) }, "+ row above \"otherwise\"")),
      tests(rule));
  }
  const rules = () => h("div", {}, S.doc.rules.map(ruleCard));

  // ---------- question texts: only those the chat asks the same way every time; the others depend on the request
  function questions() {
    const f = S.qFilter.toLowerCase(), list = S.doc.questions.filter((q) => !f || [q.key, q.label, q.q, q.ex].some((x) => String(x || "").toLowerCase().includes(f)));
    const area = (q, p, label) => h("label", { style: "display:block;margin:4px 0" }, h("span", { class: "muted" }, label), h("textarea", { id: `q-${q.key}-${p}`, rows: "2", class: changed("questions", q.key, p),
      oninput: (e) => editQuiet(() => { q[p] = e.target.value; }) }, q[p] || ""));
    return h("div", { class: "card" }, h("h2", {}, "Questions"),
      h("p", { class: "hint" }, "The label is what the side panel and the record show. The question, example and reason can be changed where the chat asks them the same way for every request; the others are worded from the request and stay in the code. With AI on, the AI uses this wording as a guide and may phrase it a little differently."),
      h("p", {}, h("input", { type: "text", id: "qFilter", placeholder: "Filter questions", "aria-label": "Filter questions", style: "width:min(360px,100%)", value: S.qFilter, oninput: (e) => { S.qFilter = e.target.value; render(); } }),
        " ", h("span", { class: "muted" }, `${list.length} of ${S.doc.questions.length}`)),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Question"), h("th", {}, "Texts"))),
        h("tbody", {}, list.map((q) => h("tr", { "data-q": q.key },
          h("td", { style: "width:280px" }, h("input", { type: "text", id: `q-${q.key}-label`, "aria-label": `Label of ${q.key}`, style: "width:100%", class: changed("questions", q.key, "label"), value: q.label, oninput: (e) => editQuiet(() => { q.label = e.target.value; }) }), h("div", { class: "muted" }, q.key)),
          h("td", {}, "q" in q ? area(q, "q", "Question") : h("div", { class: "muted" }, "Worded from the request (in the code)"), "ex" in q ? area(q, "ex", "Example") : null, "why" in q ? area(q, "why", "Why we ask") : null))))));
  }

  // ---------- guidance: texts per category that examples and suggestions are built from
  function guidance() {
    const g = S.doc.guidance.find((x) => x.key === S.gKey) || S.doc.guidance[0];
    S.gKey = g.key;
    const cats = [["_", "Any other category"], ...S.doc.categories.map((c) => [c.id, c.name])];
    const base = S.st.draft.guidance.find((x) => x.key === g.key) || { texts: {} };
    return h("div", { class: "card" }, h("h2", {}, "Guidance"),
      h("p", { class: "hint" }, "Texts per category that the chat uses for examples and suggested answers. Every suggestion tells the requester where it comes from. An empty text means the chat builds the answer from the request instead (or uses \"Any other category\")."),
      h("p", {}, h("label", {}, h("span", { class: "muted" }, "Guidance "), select(S.doc.guidance.map((x) => [x.key, x.label]), g.key, (v) => { S.gKey = v; render(); }, { id: "gKey" }))),
      h("p", { class: "hint" }, `${g.description} Source: ${g.source}, maintained by ${g.owner}.`),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Text"))),
        h("tbody", {}, cats.map(([id, name]) => h("tr", {}, h("td", { style: "width:240px" }, h("b", {}, name), id === "_" ? h("div", { class: "muted" }, "used when a category has no text") : null),
          h("td", {}, h("textarea", { id: `g-${g.key}-${id}`, "aria-label": `${g.label}: ${name}`, rows: "2", class: (base.texts[id] || "") !== (g.texts[id] || "") ? "changed" : "",
            oninput: (e) => editQuiet(() => { if (e.target.value.trim()) g.texts[id] = e.target.value; else delete g.texts[id]; }) }, g.texts[id] || "")))))));
  }

  // ---------- versions, change log, decision log (read from the server when the tab opens)
  function load(key, query) { if (S.extra[key] === undefined) { S.extra[key] = null; api("GET", null, query).then((d) => { S.extra[key] = d; render(); }, (e) => { S.extra[key] = { error: e.message }; render(); }); } return S.extra[key]; }
  const short = (v) => { const s = v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 140 ? s.slice(0, 140) + "…" : s; };
  // for one changed item, only the fields that differ
  function delta(a) {
    if (!a.before || !a.after) return short(a.after || a.before);
    const sub = (b, c) => Object.keys({ ...b, ...c }).filter((k) => !same(b[k], c[k]));
    return sub(a.before, a.after).map((k) => {
      const b = a.before[k], c = a.after[k];
      // texts per category: name the categories that changed
      if (b && c && typeof b === "object" && typeof c === "object" && !Array.isArray(b)) return sub(b, c).map((x) => `${k}.${x}: ${short(b[x])} → ${short(c[x])}`).join("; ");
      return `${k}: ${short(b)} → ${short(c)}`;
    }).join("; ");
  }
  function versions() {
    const audit = load("audit", { view: "audit" });
    return h("div", {},
      h("div", { class: "card" }, h("h2", {}, "Published versions"), h("p", { class: "hint" }, "A published version is never changed. To go back, load an earlier version into the draft and publish it as a new version."),
        S.st.versions.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Version"), h("th", {}, "Published"), h("th", {}, "By"), h("th", {}, "What changed"), h("th", {}))),
          h("tbody", {}, S.st.versions.map((v) => h("tr", {}, h("td", {}, h("b", {}, v.version), v.version === S.st.published_version ? h("span", { class: "pill ok", style: "margin-left:6px" }, "live") : null), h("td", {}, when(v.published_at)), h("td", {}, v.actor), h("td", {}, v.note || "–"),
            h("td", {}, v.version === S.st.published_version ? null : h("button", { class: "btn s", type: "button", disabled: S.unsaved, title: S.unsaved ? "Save or discard your changes first" : "", onclick: () => { if (confirm(`Load version ${v.version} into the draft? It goes live only when you publish.`)) act(() => api("POST", { action: "restore", version: v.version, revision: S.st.revision, actor: S.actor }), `Version ${v.version} loaded into the draft`); } }, "Load into draft")))))) : h("p", { class: "muted" }, "Nothing has been published yet: the page runs on the built-in configuration.")),
      h("div", { class: "card" }, h("h2", {}, "Change log"),
        !audit ? h("p", { class: "muted" }, "Loading…") : audit.error ? h("p", { class: "err" }, audit.error) : !audit.audit.length ? h("p", { class: "muted" }, "No changes yet.") :
          h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Who"), h("th", {}, "What"), h("th", {}, "Detail"))),
            h("tbody", {}, audit.audit.map((a) => h("tr", {}, h("td", {}, when(a.at)), h("td", {}, a.actor), h("td", {}, a.action === "save" ? `${a.part}: ${a.item}` : a.action === "publish" ? `Published version ${a.version}` : a.action === "restore" ? `Loaded version ${a.version} into the draft` : a.action === "discard" ? "Discarded the draft" : a.action), h("td", { class: "muted" }, a.action === "save" ? delta(a) : "")))))));
  }
  function decisions() {
    const d = load("decisions", { view: "decisions" });
    if (!d) return h("div", { class: "card" }, h("p", { class: "muted" }, "Loading…"));
    if (d.error) return h("div", { class: "card" }, h("p", { class: "err" }, d.error));
    const label = (rule, key) => { const r = S.doc.rules.find((x) => x.id === rule), o = r && r.outcomes.find((x) => x.key === key); return o ? o.label : key; };
    return h("div", {},
      h("div", { class: "card" }, h("h2", {}, "Decisions by rule and outcome"), h("p", { class: "hint" }, "Each submitted request stores which rule row decided, on which version, from which facts. Nothing the requester wrote is stored."),
        d.counts.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Rule"), h("th", {}, "Outcome"), h("th", {}, "Requests"))), h("tbody", {}, d.counts.map((c) => h("tr", {}, h("td", {}, c.rule), h("td", {}, label(c.rule, c.outcome)), h("td", {}, c.n))))) : h("p", { class: "muted" }, "No requests have been submitted yet.")),
      d.decisions.length ? h("div", { class: "card" }, h("h2", {}, "Latest decisions"),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Received"), h("th", {}, "Request"), h("th", {}, "Rule"), h("th", {}, "Row"), h("th", {}, "Outcome"), h("th", {}, "Version"), h("th", {}, "Facts"))),
          h("tbody", {}, d.decisions.map((x) => h("tr", {}, h("td", {}, when(x.received_at)), h("td", { class: "muted" }, String(x.conversation_id).slice(0, 8)), h("td", {}, x.rule), h("td", {}, x.row), h("td", {}, label(x.rule, x.outcome)), h("td", {}, `${x.config_version} (${x.config_source})`),
            h("td", { class: "muted" }, Object.entries(x.facts || {}).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${typeof v === "number" ? num(v) : v}`).join(" · "))))))) : null);
  }

  // ---------- page
  function render() {
    const y = window.scrollY, active = document.activeElement && document.activeElement.id;
    $app.replaceChildren();
    if (!S.st) { $app.append(login()); return; }
    const prob = problems();
    const body = { thresholds, channels, categories, rules, questions, guidance, versions, decisions }[S.tab]();
    $app.append(
      h("header", { class: "top" }, h("h1", {}, "Rules and settings"), h("span", { class: "muted", style: "color:#d6deef" }, S.actor ? `Signed in as ${S.actor}` : ""), h("span", { class: "sp" }),
        h("a", { href: "./" }, "Open the intake"), h("button", { class: "btn s", type: "button", onclick: () => { if (S.unsaved && !confirm("Leave without saving?")) return; S.code = ""; sessionStorage.removeItem("adm"); S.st = null; S.extra = {}; render(); } }, "Sign out")),
      h("main", { class: "wrap" }, statusBar(),
        S.error ? h("div", { class: "problems", role: "alert" }, S.error) : null,
        prob.length ? h("div", { class: "problems", id: "problems" }, h("b", {}, "Fix these before publishing"), h("ul", {}, prob.slice(0, 12).map((p) => h("li", {}, p)))) : null,
        h("nav", { class: "tabs", role: "tablist" }, TABS.map(([k, l]) => h("button", { class: "tab", role: "tab", type: "button", "aria-selected": String(S.tab === k), "data-tab": k, onclick: () => { S.tab = k; if (k === "versions") delete S.extra.audit; if (k === "decisions") delete S.extra.decisions; render(); } }, l))),
        body));
    window.scrollTo(0, y);
    if (active) { const el = document.getElementById(active); if (el) el.focus(); }
  }
  window.addEventListener("beforeunload", (e) => { if (S.unsaved) { e.preventDefault(); e.returnValue = ""; } });

  (async () => {
    if (S.code) { try { take(await api("GET")); } catch (e) { S.code = ""; sessionStorage.removeItem("adm"); } }
    render();
  })();
})();
