/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
/* The admin page: the configuration in five areas (routing, checks and reviews, conversation, reference data, history),
   edited as a draft and published as a new version. A simple view shows each rule as sentences and texts; "Show
   advanced settings" adds the full rule editor, the test cases and the rarely changed limits. Everything is built with DOM nodes and textContent, never innerHTML, so nothing typed here or read from
   the database can become markup. The rules are checked in the browser with the same engine the page and the server run. */
(function () {
  "use strict";
  const $app = document.getElementById("app");
  const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const S = { code: sessionStorage.getItem("adm") || "", actor: stored("adm-name") || "", st: null, doc: null, area: "overview", section: "", advanced: stored("adm-advanced") === "1", search: "",
    unsaved: false, extra: {}, busy: false, qFilter: "", ruleStep: "", gKey: "", dKey: "", refFilter: {}, refNote: {} };

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
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const num = (v) => new Intl.NumberFormat("en-GB").format(v);
  const when = (t) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // key order does not matter: a document read back from the database has its keys in another order
  const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
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
    try { const out = await fn(); if (out) take(out); if (done) toast(done); delete S.extra.audit; }
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
    (doc.divisions || []).forEach((d) => { if (!String(d.name || "").trim() || !String(d.vendor_office || "").trim()) out.push(`Division ${d.id} has no name or vendor office`); });
    (doc.lists || []).forEach((l) => l.items.forEach((it, i) => { if (!String(it.name || "").trim() || !it.keywords.length) out.push(`${l.label}, entry ${i + 1}: needs a name and at least one search word`); }));
    doc.rules.forEach((rule) => {
      out.push(...Engine.validateRule(rule, registry, params));
      Engine.runTests(rule, params).filter((t) => !t.ok).forEach((t) => out.push(`${rule.id}: test "${t.name}" expects ${t.expect}, got ${t.got}`));
    });
    // the reference data, next steps, entities, domains, examples and the order of limits are checked by the server when the draft is saved
    if (!S.unsaved) (S.st.problems || []).filter((p) => /^(Level 4|Supplier|Contract|Catalogue|next steps|legal entity|operations domain|welcome examples|headline|executive description|typical day rate|quality)/.test(p)).forEach((p) => out.push(p));
    return out;
  }
  function edit(fn) { fn(); S.unsaved = !same(S.doc, S.st.draft); S.error = ""; render(); }
  // an edit inside a text field: keep typing without a re-render, refresh the status bar only
  function editQuiet(fn) { fn(); S.unsaved = !same(S.doc, S.st.draft); S.error = ""; const bar = document.getElementById("statusbar"); if (bar) bar.replaceWith(statusBar()); refreshMarks(); }
  // the "changed" dots in the area and section navigation, updated while typing (no re-render)
  function refreshMarks() {
    const mark = (el, on) => { const dot = el.querySelector(".dot"); if (on && !dot) el.append(h("span", { class: "dot", title: "changed" })); if (!on && dot) dot.remove(); };
    document.querySelectorAll("[data-area]").forEach((el) => { const a = AREAS.find((x) => x.key === el.dataset.area); if (a) mark(el, a.sections.some(isChanged)); });
    document.querySelectorAll("[data-section]").forEach((el) => { const [a, k] = el.dataset.section.split("/"); const sec = sectionOf(a, k); if (sec) mark(el, isChanged(sec)); });
  }

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
      S.extra = {};
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
      h("button", { class: "btn", id: "previewBtn", type: "button", title: "Opens the chat on this draft, in this browser only. Nothing is published or stored.", onclick: preview }, "Try the draft in the chat"),
      h("button", { class: "btn", id: "saveBtn", disabled: !S.unsaved || S.busy, onclick: save }, "Save draft"),
      h("button", { class: "btn", id: "discardBtn", disabled: !(st.dirty || S.unsaved) || S.busy, onclick: () => { if (confirm("Discard all changes since the published version?")) act(() => api("POST", { action: "discard", revision: S.st.revision, actor: S.actor }), "Draft reset to the published version"); } }, "Discard changes"),
      h("button", { class: "btn a", id: "publishBtn", disabled: S.unsaved || !st.dirty || prob.length > 0 || S.busy, title: S.unsaved ? "Save the draft first" : prob.length ? "Fix the problems first" : "", onclick: publish }, "Publish…"));
  }
  // the chat runs on this draft in a new tab, in this browser only (same site, local storage); nothing is published
  function preview() {
    try { localStorage.setItem("cfg-preview", JSON.stringify({ ...clone(S.doc), version: S.st.published_version, source: "preview", checksum: "000000000000", ref_checksum: "" })); }
    catch (e) { S.error = "The draft is too large to preview in this browser."; render(); return; }
    window.open("./?preview=1", "_blank", "noopener");
  }
  function publish() {
    const note = prompt(`Publish the draft as version ${S.st.published_version + 1}?\nNew conversations use it within a minute.\n\nWhat changed (shown in the version list):`, "");
    if (note === null) return;
    act(() => api("POST", { action: "publish", revision: S.st.revision, note, actor: S.actor }), "Published");
  }

  // ---------- tabs
  const changed = (part, key, field) => { const id = ["categories", "rules", "divisions", "entities", "domains"].includes(part) ? "id" : "key"; const a = (S.st.draft[part] || []).find((x) => x[id] === key), b = S.doc[part].find((x) => x[id] === key); return a && b && !same(a[field], b[field]) ? "changed" : ""; };

  function thresholds(groups, only) {
    const shown = (p) => groups.includes(p.group || "Other") && (!only || only(p));
    return h("div", {}, groups.filter((g) => S.doc.params.some((p) => (p.group || "Other") === g && shown(p))).map((g, i) => h("div", { class: "card", "data-group": g }, h("h2", {}, g),
      i === 0 && S.doc.params.some((p) => (p.group || "Other") === g && /EUR/.test(p.unit || "")) ? h("p", { class: "hint" }, "Amounts are in euros. The rules and checks read these values by name, so a change here changes everything that uses them.") : null,
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Setting"), h("th", {}, "Value"), h("th", {}, "Unit"), h("th", {}, "Effect"))),
        h("tbody", {}, S.doc.params.filter((p) => (p.group || "Other") === g && shown(p)).map((p) => h("tr", {},
          h("td", {}, h("label", { for: "p-" + p.key }, h("b", {}, p.label))),
          h("td", {}, h("input", { type: "number", id: "p-" + p.key, min: "0", step: "any", class: changed("params", p.key, "value"), value: p.value, oninput: (e) => editQuiet(() => { p.value = e.target.value === "" ? NaN : Number(e.target.value); }), onchange: later })),
          h("td", { class: "muted" }, p.unit), h("td", { class: "muted" }, p.description))))))));
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
    return h("div", { class: "card" }, h("h2", {}, "Category rules"), h("p", { class: "hint" }, "Two flags per category are read by the who-leads rule. Mandatory: between the two thresholds procurement leads instead of the Category Manager deciding. Renewals calendar: a renewal in this category goes to procurement without a sourcing request form."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Category Manager mandatory"), h("th", {}, "Renewals calendar"))),
        h("tbody", {}, S.doc.categories.map((c) => h("tr", { class: changed("categories", c.id, "cm_mandatory") || changed("categories", c.id, "renewals_calendar") },
          h("td", {}, h("input", { type: "text", id: `cat-${c.id}-name`, "aria-label": `Name of ${c.id}`, style: "width:300px", class: changed("categories", c.id, "name"), value: c.name, oninput: (e) => editQuiet(() => { c.name = e.target.value; }) }), " ", h("span", { class: "muted" }, c.id)),
          h("td", {}, box(c, "cm_mandatory", "Category Manager mandatory")), h("td", {}, box(c, "renewals_calendar", "renewals calendar")))))));
  }
  function categoryWords() {
    return h("div", { class: "card" }, h("h2", {}, "Category search words"), h("p", { class: "hint" }, "Words in a request that point to a buying category, separated by commas. Whole words; a trailing * matches longer words too (\"freelance*\" finds freelancers)."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Search words"))),
        h("tbody", {}, S.doc.categories.map((c) => h("tr", {}, h("td", { style: "width:220px" }, h("b", {}, c.name)),
          h("td", {}, h("input", { type: "text", id: `cat-${c.id}-kw`, "aria-label": `Search words for ${c.name}`, style: "width:100%", class: changed("categories", c.id, "keywords"), value: (c.keywords || []).join(", "), oninput: (e) => editQuiet(() => { c.keywords = e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); }) })))))));
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
      const rel = v && typeof v === "object", opts = [["", "–"], ["n", "number"], ...S.doc.params.filter((p) => /EUR/.test(p.unit) && (p.group || "Routing") === "Routing").flatMap((p) => [[`${p.key}|-1`, `just under ${num(p.value)}`], [`${p.key}|0`, `exactly ${num(p.value)}`], [`${p.key}|1`, `just over ${num(p.value)}`]])];
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
  // the facts a rule reads, in plain words, and where each comes from
  function reads(rule) {
    const registry = registryOf(S.doc), keys = [...new Set(rule.rows.flatMap((r) => (r.when || []).map((c) => c.fact)))].filter((k) => registry[k]);
    if (!keys.length) return null;
    return h("div", { class: "reads", "data-reads": rule.id }, h("b", {}, "Reads: "), keys.map((k, i) => h("span", {}, i ? " · " : "", registry[k].label, registry[k].source ? h("span", { class: "muted" }, ` (${registry[k].source.charAt(0).toLowerCase() + registry[k].source.slice(1)})`) : null)));
  }
  // which rules read the answer to a question (through the facts it fills)
  function usedBy(qkey) {
    const facts = S.doc.facts.filter((f) => (f.from || []).includes(qkey) || f.key === qkey).map((f) => f.key);
    return S.doc.rules.filter((r) => r.rows.some((row) => (row.when || []).some((c) => facts.includes(c.fact)))).map((r) => r.id);
  }
  // a row's conditions as one sentence, from the fact labels, the comparison names and the thresholds
  function rowSummary(rule, row) {
    if (!(row.when || []).length) return "Otherwise";
    const registry = registryOf(S.doc), val = (c, f) => {
      const v = c.value;
      if (v && typeof v === "object" && !Array.isArray(v)) return paramLabel(S.doc, v.param);
      if (Array.isArray(v)) return v.join(" or ");
      if (typeof v === "boolean") return v ? "yes" : "no";
      return f && f.type === "number" && typeof v === "number" ? num(v) : String(v);
    };
    return "When " + row.when.map((c) => { const f = registry[c.fact], op = Engine.OPS[c.op]; return `${f ? f.label.charAt(0).toLowerCase() + f.label.slice(1) : c.fact} ${op ? op.label : c.op}${op && op.value ? " " + val(c, f) : ""}`; }).join(", and ");
  }
  function simpleRow(rule, i) {
    const row = rule.rows[i], out = rule.outcomes.find((o) => o.key === row.then) || { label: row.then };
    return h("div", { class: "row" + (i === rule.rows.length - 1 ? " else" : ""), "data-row": String(i + 1) },
      h("div", { class: "line" }, h("span", { class: "rownum" }, `${i + 1}.`), h("span", {}, rowSummary(rule, row)), h("span", { class: "muted" }, "→"), h("b", {}, out.flag ? out.title || out.label : out.label)),
      "text" in row || (rule.placeholders || []).length ? h("div", {}, h("div", { class: "muted", style: "margin-top:4px" }, `What the requester is told.${(rule.placeholders || []).length ? " Placeholders: " + rule.placeholders.map((x) => `{${x}}`).join(" ") : ""}`),
        h("textarea", { "aria-label": `Reason text of row ${i + 1}`, oninput: (e) => editQuiet(() => { if (e.target.value) row.text = e.target.value; else delete row.text; }) }, row.text || "")) : null);
  }
  function ruleCard(rule) {
    const text = (f, label, w) => h("label", { style: "display:block;margin:6px 0" }, h("span", { class: "muted" }, label), h("br"), h("input", { type: "text", style: `width:${w}`, class: changed("rules", rule.id, f), value: rule[f] || "", oninput: (e) => editQuiet(() => { rule[f] = e.target.value; }) }));
    const bad = Engine.validateRule(rule, registryOf(S.doc), paramsOf(S.doc));
    return h("div", { class: "card", id: "rule-" + rule.id, "data-rule": rule.id },
      h("div", { style: "display:flex;gap:10px;align-items:baseline;flex-wrap:wrap" }, h("h2", {}, `${rule.id}  ${rule.name}`), h("span", { class: "pill" }, rule.step), !same(rule, S.st.draft.rules.find((r) => r.id === rule.id)) ? h("span", { class: "pill warn" }, "changed") : null),
      h("p", { class: "hint" }, rule.decides),
      reads(rule),
      h("details", {}, h("summary", {}, "Name, purpose and policy"),
        text("name", "Name — shown on the route card (\"Based on …\") and in the decision log", "min(520px,100%)"),
        text("decides", "What it decides — shown in the record and the service description as why the check exists", "100%"),
        text("clause", "Rests on (policy and clause) — shown on the route card and in the record next to the decision", "100%")),
      flagOutcomes(rule),
      h("p", { class: "hint", style: "margin-top:10px" }, "The rows are checked from top to bottom. The first row whose conditions all hold gives the outcome."),
      bad.length ? h("div", { class: "problems" }, h("b", {}, "This rule has problems"), h("ul", {}, bad.map((b) => h("li", {}, b.replace(rule.id + ": ", ""))))) : null,
      S.advanced ? [rule.rows.map((_, i) => ruleRow(rule, i)),
        h("p", {}, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { const f = S.doc.facts[0]; rule.rows.splice(rule.rows.length - 1, 0, { when: [{ fact: f.key, op: "is", value: defaultValue(f, "is") }], then: rule.outcomes[0].key }); }) }, "+ row above \"otherwise\"")),
        tests(rule)]
        : [rule.rows.map((_, i) => simpleRow(rule, i)), testSummary(rule)]);
  }
  // simple view: the tests still run; only their result is shown
  function testSummary(rule) {
    const results = Engine.runTests(rule, paramsOf(S.doc)), ok = results.filter((r) => r.ok).length;
    return h("p", { class: ok === results.length ? "pass" : "fail", "data-tests": rule.id }, ok === results.length ? `✓ All ${results.length} test cases pass` : `✗ ${results.length - ok} of ${results.length} test cases fail: switch on advanced settings to see them`);
  }
  // the flag an outcome raises: its title, how it is shown, and who reviews it
  const LEVELS = [["i", "Information (blue)"], ["w", "Review needed (amber)"], ["b", "Procurement checks first (red)"]];
  function flagOutcomes(rule) {
    const flagged = rule.outcomes.filter((o) => o.flag);
    if (!flagged.length) return null;
    return h("div", { class: "row", style: "background:#fff" }, h("div", { class: "muted" }, "The flag the requester and the reviewers see"),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Outcome"), h("th", {}, "Title"), h("th", {}, "Shown as"), h("th", {}, "Reviewed or approved by"))),
        h("tbody", {}, flagged.map((o) => h("tr", { "data-outcome": o.key },
          h("td", {}, o.label),
          h("td", {}, h("input", { type: "text", id: `fl-${rule.id}-${o.key}-title`, "aria-label": `Title of ${rule.id} ${o.label}`, style: "width:260px", value: o.title || "", oninput: (e) => editQuiet(() => { o.title = e.target.value; }) })),
          h("td", {}, select(LEVELS, o.level, (v) => edit(() => { o.level = v; }), { id: `fl-${rule.id}-${o.key}-level`, "aria-label": `Level of ${rule.id} ${o.label}` })),
          h("td", {}, h("input", { type: "text", id: `fl-${rule.id}-${o.key}-owner`, "aria-label": `Reviewer of ${rule.id} ${o.label}`, style: "width:240px", value: o.owner || "", oninput: (e) => editQuiet(() => { o.owner = e.target.value; }) })))))));
  }
  // the routing rules, or the review flags (many cards: pick a step to see only its cards)
  const ROUTING = ["R01", "R02", "R11", "R19"], isFlagRule = (r) => !ROUTING.includes(r.id);
  function rules(flags) {
    const all = S.doc.rules.filter((r) => isFlagRule(r) === flags), steps = [...new Set(all.map((r) => r.step))];
    if (S.ruleStep && !steps.includes(S.ruleStep)) S.ruleStep = "";
    const list = all.filter((r) => !S.ruleStep || r.step === S.ruleStep);
    const jump = (id) => h("button", { class: "btn s", type: "button", onclick: () => { const el = document.getElementById("rule-" + id); if (el) el.scrollIntoView({ block: "start" }); } }, id);
    return h("div", {}, h("div", { class: "card" }, h("p", { class: "hint", style: "margin:0 0 8px" }, flags
        ? "Each card raises one review flag: when it applies, what the requester and the reviewers are told, how it is shown and who reviews it."
        : "These rules decide the buying channel, in order: the catalogue, an existing contract, who leads new demand, then the channel."),
      h("div", { class: "checks" }, flags ? h("label", {}, "Show ", select([["", `All (${all.length} rules)`], ...steps.map((st) => [st, `${st} (${all.filter((r) => r.step === st).length})`])], S.ruleStep, (v) => { S.ruleStep = v; render(); }, { id: "ruleStep", "aria-label": "Show the rules of one step" })) : null,
        h("span", { class: "muted" }, "Jump to: "), list.map((r) => jump(r.id)))),
      list.map(ruleCard));
  }

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
        h("tbody", {}, list.filter((q) => "q" in q || f).map((q) => h("tr", { "data-q": q.key },
          h("td", { style: "width:280px" }, h("input", { type: "text", id: `q-${q.key}-label`, "aria-label": `Label of ${q.key}`, style: "width:100%", class: changed("questions", q.key, "label"), value: q.label, oninput: (e) => editQuiet(() => { q.label = e.target.value; }) }), h("div", { class: "muted" }, q.key),
            (() => { const ids = usedBy(q.key); return h("div", { class: "usedby", "data-usedby": q.key }, ids.length ? `Decides: ${ids.join(", ")}` : "Recorded in the request and the service description"); })()),
          h("td", {}, "q" in q ? area(q, "q", "Question") : h("div", { class: "muted" }, "Worded from the request (in the code)"),
            q.ex ? area(q, "ex", "Example (shown under the question)") : h("button", { type: "button", class: "link", style: "font-size:13px", onclick: () => edit(() => { q.ex = "For example: "; }) }, "+ Add an example"),
            "why" in q ? area(q, "why", "Why we ask (the answer to \"why do you need that?\")") : null,
            q.choices ? h("label", { style: "display:block;margin:4px 0" }, h("span", { class: "muted" }, "Answer buttons, one per line (the answer is recorded as written; up to 6)"),
              h("textarea", { id: `q-${q.key}-choices`, rows: "3", class: changed("questions", q.key, "choices"), oninput: (e) => editQuiet(() => { q.choices = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean); }) }, q.choices.join("\n"))) : null,
            q.applies ? h("div", { class: "checks", style: "margin-top:6px" }, h("span", { class: "muted" }, "Asked for:"), S.doc.divisions.map((d) => h("label", {}, `${d.name} `,
              select([["R", "required"], ["C", "conditional"], ["-", "not asked"]], q.applies[d.id], (v) => edit(() => { q.applies[d.id] = v; }), { "aria-label": `${q.label}: ${d.name}`, id: `qa-${q.key}-${d.id}` })))) : null))))),
      f ? null : h("details", { style: "margin-top:12px" }, h("summary", {}, `Asked in the chat's own words (${list.filter((q) => !("q" in q)).length}): only the label can be changed`),
        h("p", { class: "hint" }, "The chat words these from the request, so their text stays in the code. The label is what the side panel and the record show."),
        h("table", {}, h("tbody", {}, list.filter((q) => !("q" in q)).map((q) => h("tr", { "data-q": q.key },
          h("td", { style: "width:280px" }, h("input", { type: "text", id: `q-${q.key}-label`, "aria-label": `Label of ${q.key}`, style: "width:100%", class: changed("questions", q.key, "label"), value: q.label, oninput: (e) => editQuiet(() => { q.label = e.target.value; }) })),
          h("td", { class: "muted" }, q.key, " · ", (() => { const ids = usedBy(q.key); return ids.length ? `Decides: ${ids.join(", ")}` : "Recorded in the request"; })())))))));
  }

  // ---------- divisions, legal entities and the review lists the checks read
  function divisions() {
    return h("div", {},
      h("div", { class: "card" }, h("h2", {}, "Divisions and vendor offices"), h("p", { class: "hint" }, "New demand asks which division it is for. The division decides which vendor office reviews the request (named in the record and in the review flags) and, under Conversation › Questions, which ownership questions are asked."),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Division"), h("th", {}, "Vendor office"))),
          h("tbody", {}, S.doc.divisions.map((d) => h("tr", {},
            h("td", {}, h("input", { type: "text", id: `d-${d.id}-name`, "aria-label": `Name of ${d.id}`, style: "width:320px", class: changed("divisions", d.id, "name"), value: d.name, oninput: (e) => editQuiet(() => { d.name = e.target.value; }) }), " ", h("span", { class: "muted" }, d.id)),
            h("td", {}, h("input", { type: "text", id: `d-${d.id}-office`, "aria-label": `Vendor office of ${d.id}`, style: "width:380px", class: changed("divisions", d.id, "vendor_office"), value: d.vendor_office, oninput: (e) => editQuiet(() => { d.vendor_office = e.target.value; }) }))))))));
  }
  function entities() {
    return h("div", {},
      h("div", { class: "card", "data-entities": "" }, h("h2", {}, "Legal entities"), h("p", { class: "hint" }, "The entity that receives the service and signs the contract. It is recognised from the search words (any case) or the short codes (capitals only, so \"US\" is not \"us\"). EU is the entity the data transfer check reads."),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Entity"), h("th", {}, "Country"), h("th", {}, "Search words"), h("th", {}, "Short codes"))),
          h("tbody", {}, S.doc.entities.map((e) => h("tr", {},
            h("td", {}, h("input", { type: "text", id: `en-${e.id}-name`, "aria-label": `Name of ${e.id}`, style: "width:240px", class: changed("entities", e.id, "name"), value: e.name, oninput: (ev) => editQuiet(() => { e.name = ev.target.value; }) }), " ", h("span", { class: "muted" }, e.id)),
            h("td", {}, h("input", { type: "text", "aria-label": `Country of ${e.id}`, style: "width:140px", value: e.country, oninput: (ev) => editQuiet(() => { e.country = ev.target.value; }) })),
            h("td", {}, h("input", { type: "text", id: `en-${e.id}-keywords`, "aria-label": `Search words for ${e.id}`, style: "width:100%", value: e.keywords.join(", "), oninput: (ev) => editQuiet(() => { e.keywords = ev.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); }) })),
            h("td", {}, h("input", { type: "text", "aria-label": `Short codes for ${e.id}`, style: "width:90px", value: e.codes.join(", "), oninput: (ev) => editQuiet(() => { e.codes = ev.target.value.split(",").map((x) => x.trim()).filter(Boolean); }) }))))))));
  }
  function reviewLists() {
    const words = (it) => it.keywords.join(", ");
    return h("div", {},
      S.doc.lists.map((l) => h("div", { class: "card", id: `list-${l.key}`, "data-list": l.key }, h("h2", {}, l.label), h("p", { class: "hint" }, `${l.description} Maintained by ${l.owner}.`),
        h("p", { class: "hint" }, "Search words are matched as whole words in what the requester writes; end a word with * to match longer words too (\"lobbyist*\" finds lobbyists)."),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Name shown in the flag"), h("th", {}, "Search words, separated by commas"), h("th", {}))),
          h("tbody", {}, l.items.map((it, i) => h("tr", {},
            h("td", {}, h("input", { type: "text", "aria-label": "Name", style: "width:300px", value: it.name, oninput: (e) => editQuiet(() => { it.name = e.target.value; }) })),
            h("td", {}, h("input", { type: "text", "aria-label": `Search words for ${it.name}`, style: "width:100%", value: words(it), oninput: (e) => editQuiet(() => { it.keywords = e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); }) })),
            h("td", {}, h("button", { class: "btn s x", type: "button", "aria-label": `Remove ${it.name}`, onclick: () => edit(() => { l.items.splice(i, 1); }) }, "✕")))))),
        h("p", {}, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { l.items.push({ name: "New entry", keywords: [] }); }) }, "+ entry")))));
  }

  // ---------- reference data: download as CSV, edit in a spreadsheet, upload, check, publish
  // columns as the import script reads them; lists inside a cell are separated by ";"
  const REF = {
    l4: { label: "Level 4 list", key: "code", cols: ["code", "name", "l1", "l2", "l3", "theme", "desc", "kw"], lists: ["kw"], nums: [], hint: "theme is the buying category id (see Routing › Category matching and rules); kw are search words." },
    suppliers: { label: "Suppliers", key: "name", cols: ["supplier", "preferred_l4"], field: { supplier: "name" }, lists: ["preferred_l4"], nums: [], hint: "preferred_l4: the Level 4 codes the supplier is preferred for." },
    contracts: { label: "Framework contracts", key: "id", cols: ["id", "supplier", "title", "l4", "expires", "remaining"], lists: ["l4"], nums: ["remaining"], hint: "l4: the Level 4 codes it covers; expires: YYYY-MM-DD; remaining: the value left, in euro." },
    catalogue: { label: "Catalogue", key: "id", cols: ["id", "kind", "name", "supplier", "l4", "price", "max_order", "unit", "kw"], lists: ["kw"], nums: ["price", "max_order"], hint: "kind: item (a fixed price) or shop (a supplier's shop for a whole Level 4, with a maximum order value)." },
  };
  const fieldOf = (r, col) => (r.field && r.field[col]) || col;
  function csvOut(part) {
    const r = REF[part], cell = (v) => { const t = Array.isArray(v) ? v.join(";") : v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(t) && !Array.isArray(v) || /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return [r.cols.join(","), ...S.doc[part].map((e) => r.cols.map((c) => cell(e[fieldOf(r, c)])).join(","))].join("\n") + "\n";
  }
  function csvRows(text) {   // RFC 4180: quoted cells may hold commas, quotes ("") and line breaks
    const rows = []; let row = [], cell = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }
  function csvIn(part, text) {
    const r = REF[part], rows = csvRows(text);
    if (!rows.length) throw new Error("The file is empty.");
    const head = rows[0].map((h) => h.trim().toLowerCase()), missing = r.cols.filter((c) => !head.includes(c));
    if (missing.length) throw new Error(`The first row must name the columns ${r.cols.join(", ")}. Missing: ${missing.join(", ")}.`);
    return rows.slice(1).map((cells) => Object.fromEntries(r.cols.map((c) => {
      const v = (cells[head.indexOf(c)] || "").trim();
      return [fieldOf(r, c), r.lists.includes(c) ? v.split(";").map((x) => x.trim()).filter(Boolean) : r.nums.includes(c) ? (v === "" ? null : Number(v.replace(/[€\s]/g, "").replace(/,(?=\d{3}\b)/g, ""))) : v];
    })));
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function reference(only) {
    return h("div", {}, h("div", { class: "card" },
      h("p", { class: "hint", style: "margin:0" }, "Download the list as CSV, change it in a spreadsheet, and upload it: the upload replaces the whole list in the draft. Save the draft to have it checked (every Level 4 in a known category, every link to an existing entry), then publish. The lists shipped with the prototype are example data.")),
      Object.entries(REF).filter(([part]) => part === only).map(([part, r]) => {
        const list = S.doc[part], f = (S.refFilter[part] || "").toLowerCase(), base = S.st.draft[part] || [];
        const shown = (f ? list.filter((e) => JSON.stringify(e).toLowerCase().includes(f)) : list).slice(0, 8);
        const file = h("input", { type: "file", accept: ".csv,text/csv", id: `ref-${part}-file`, "aria-label": `Upload ${r.label} as CSV`, style: "display:none", onchange: (e) => {
          const fl = e.target.files[0]; if (!fl) return;
          fl.text().then((t) => { try { const rows = csvIn(part, t); edit(() => { S.doc[part] = rows; S.refNote[part] = `${fl.name}: ${rows.length} entries loaded into the draft. Save the draft to check them.`; }); } catch (x) { S.refNote[part] = `${fl.name}: ${x.message}`; render(); } });
        } });
        return h("div", { class: "card", "data-ref": part },
          h("div", { style: "display:flex;gap:10px;align-items:baseline;flex-wrap:wrap" }, h("h2", {}, r.label), h("span", { class: "pill" }, `${list.length} entries`), !same(list, base) ? h("span", { class: "pill warn" }, "changed") : null, h("span", { style: "flex:1" }),
            h("button", { class: "btn s", type: "button", id: `ref-${part}-download`, onclick: () => download(`${part}.csv`, csvOut(part)) }, "Download CSV"),
            h("button", { class: "btn s", type: "button", id: `ref-${part}-upload`, disabled: S.busy, onclick: () => file.click() }, "Upload CSV"), file),
          h("p", { class: "hint" }, `Columns: ${r.cols.join(", ")}. ${r.hint}`),
          S.refNote[part] ? h("p", { class: "muted", role: "status" }, S.refNote[part]) : null,
          h("p", {}, h("input", { type: "text", "aria-label": `Search ${r.label}`, placeholder: "Search", style: "width:min(320px,100%)", value: S.refFilter[part] || "", oninput: (e) => { S.refFilter[part] = e.target.value; render(); } }),
            " ", h("span", { class: "muted" }, f ? `${list.filter((e) => JSON.stringify(e).toLowerCase().includes(f)).length} found, first 8 shown` : "first 8 shown")),
          h("div", { style: "overflow-x:auto" }, h("table", {}, h("thead", {}, h("tr", {}, r.cols.map((c) => h("th", {}, c)))),
            h("tbody", {}, shown.map((e) => h("tr", {}, r.cols.map((c) => { const v = e[fieldOf(r, c)]; const t = Array.isArray(v) ? v.join("; ") : v ?? ""; return h("td", { class: c === "desc" ? "muted" : "", style: ["code", "id", "theme", "l4", "kind", "expires"].includes(c) ? "white-space:nowrap" : null }, String(t).length > 90 ? String(t).slice(0, 90) + "…" : String(t)); })))))));
      }));
  }

  // ---------- guidance: texts per category that examples and suggestions are built from
  function guidance() {
    const g = S.doc.guidance.find((x) => x.key === S.gKey) || S.doc.guidance[0];
    S.gKey = g.key;
    const used = g.categories || S.doc.categories.map((c) => c.id);
    // "Any other category" only where the chat has a fallback text; otherwise it builds the line from the request
    const cats = [...("_" in g.texts ? [["_", "Any other category"]] : []), ...S.doc.categories.filter((c) => used.includes(c.id)).map((c) => [c.id, c.name])];
    const base = S.st.draft.guidance.find((x) => x.key === g.key) || { texts: {} };
    return h("div", { class: "card" }, h("h2", {}, "Guidance"),
      h("p", { class: "hint" }, "Texts per category that the chat uses for examples and suggested answers. Every suggestion tells the requester where it comes from. An empty text means the chat builds the answer from the request instead (or uses \"Any other category\")."),
      h("p", {}, h("label", {}, h("span", { class: "muted" }, "Guidance "), select(S.doc.guidance.map((x) => [x.key, x.label]), g.key, (v) => { S.gKey = v; render(); }, { id: "gKey" }))),
      h("p", { class: "hint" }, `${g.description} Used for ${used.length === S.doc.categories.length ? "every category" : `${used.length} categories`}. Source: ${g.source}, maintained by ${g.owner}.`),
      "_" in g.texts ? null : h("p", { class: "muted" }, "Other categories: the chat builds this line from the request."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Text"))),
        h("tbody", {}, cats.map(([id, name]) => h("tr", {}, h("td", { style: "width:240px" }, h("b", {}, name), id === "_" ? h("div", { class: "muted" }, "used when a category has no text") : null),
          h("td", {}, h("textarea", { id: `g-${g.key}-${id}`, "aria-label": `${g.label}: ${name}`, rows: "2", class: (base.texts[id] || "") !== (g.texts[id] || "") ? "changed" : "",
            oninput: (e) => editQuiet(() => { if (e.target.value.trim()) g.texts[id] = e.target.value; else delete g.texts[id]; }) }, g.texts[id] || "")))))));
  }

  // ---------- next steps per channel: what the route card tells the requester happens next
  function nextsteps() {
    return h("div", {}, h("div", { class: "card" }, h("h2", {}, "Next steps"), h("p", { class: "hint" }, "The steps the route card shows for each channel. Placeholders are filled from the request; an optional one, such as {needed} or {preferred}, fills as nothing when it does not apply.")),
      S.doc.next_steps.map((n) => h("div", { class: "card", "data-steps": n.key }, h("h3", {}, n.label),
        h("p", { class: "muted" }, n.placeholders.length ? "Placeholders: " + n.placeholders.map((x) => `{${x}}`).join(" ") : "No placeholders"),
        n.steps.map((t, i) => h("div", { class: "row", style: "display:flex;gap:8px;align-items:flex-start" }, h("span", { class: "rownum" }, `${i + 1}.`),
          h("textarea", { id: `ns-${n.key}-${i}`, "aria-label": `${n.label}, step ${i + 1}`, rows: "2", class: changed("next_steps", n.key, "steps"), oninput: (e) => editQuiet(() => { n.steps[i] = e.target.value; }) }, t),
          h("button", { class: "btn s x", type: "button", "aria-label": `Remove step ${i + 1}`, disabled: n.steps.length < 2, onclick: () => edit(() => { n.steps.splice(i, 1); }) }, "✕"))),
        n.steps.length < 5 ? h("p", {}, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { n.steps.push("New step"); }) }, "+ step")) : null)));
  }

  // ---------- operations domains (guidance and search words) and the welcome screen's examples
  const DOMAIN_FIELDS = [["bg", "Example background (why now)"], ["aud", "Target audience"], ["fun", "Supported functions"], ["ben", "Key benefits"], ["kpi", "Success measures"], ["sl", "Service levels"],
    ["reg", "Regulatory and governance benefits"], ["out", "Out of scope"], ["mh", "Must-haves"], ["qual", "Supplier qualifications"], ["deps", "What we provide"], ["personal", "Personal data usually involved"],
    ["important", "Why it may support a critical or important function (empty: usually not)"], ["notes", "Notes for the buyer"]];
  function examples() {
    return h("div", {},
      h("div", { class: "card", "data-examples": "" }, h("h2", {}, "Welcome examples"), h("p", { class: "hint" }, "The example requests on the welcome screen, in groups. At least 3, up to 12."),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Group"), h("th", {}, "Label"), h("th", {}, "Request"), h("th", {}))),
          h("tbody", {}, S.doc.examples.map((x, i) => h("tr", {},
            h("td", {}, h("input", { type: "text", "aria-label": `Group of example ${i + 1}`, style: "width:130px", value: x.group, oninput: (e) => editQuiet(() => { x.group = e.target.value; }) })),
            h("td", {}, h("input", { type: "text", "aria-label": `Label of example ${i + 1}`, style: "width:150px", value: x.label, oninput: (e) => editQuiet(() => { x.label = e.target.value; }) })),
            h("td", {}, h("input", { type: "text", id: `ex-${i}`, "aria-label": `Request of example ${i + 1}`, style: "width:100%", value: x.text, oninput: (e) => editQuiet(() => { x.text = e.target.value; }) })),
            h("td", {}, h("button", { class: "btn s x", type: "button", "aria-label": `Remove example ${i + 1}`, disabled: S.doc.examples.length <= 3, onclick: () => edit(() => { S.doc.examples.splice(i, 1); }) }, "✕")))))),
        S.doc.examples.length < 12 ? h("p", {}, h("button", { class: "btn s", type: "button", onclick: () => edit(() => { S.doc.examples.push({ group: "New demand", label: "New example", text: "Describe a request here." }); }) }, "+ example")) : null));
  }
  function domains() {
    const d = S.doc.domains.find((x) => x.id === S.dKey) || S.doc.domains[0];
    S.dKey = d.id;
    const csv = (list) => list.join(", "), fromCsv = (v) => v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    return h("div", {},
      h("div", { class: "card", "data-domain": d.id }, h("h2", {}, "Operations and service domains"),
        h("p", { class: "hint" }, "A domain is recognised from its search words (the one mentioned first wins) and gives the examples and suggested answers for that kind of work. The flags for record keeping and critical functions read the domain too."),
        h("p", {}, h("label", {}, h("span", { class: "muted" }, "Domain "), select(S.doc.domains.map((x) => [x.id, x.name]), d.id, (v) => { S.dKey = v; render(); }, { id: "dKey" }))),
        h("label", { style: "display:block;margin:6px 0" }, h("span", { class: "muted" }, "Name"), h("br"), h("input", { type: "text", id: `dm-${d.id}-name`, style: "width:min(420px,100%)", class: changed("domains", d.id, "name"), value: d.name, oninput: (e) => editQuiet(() => { d.name = e.target.value; }) })),
        h("label", { style: "display:block;margin:6px 0" }, h("span", { class: "muted" }, "Search words, separated by commas (whole words; end with * for longer words too)"), h("br"),
          h("input", { type: "text", id: `dm-${d.id}-keywords`, style: "width:100%", class: changed("domains", d.id, "keywords"), value: csv(d.keywords), oninput: (e) => editQuiet(() => { d.keywords = fromCsv(e.target.value); }) })),
        DOMAIN_FIELDS.filter(([k]) => k in d).map(([k, label]) => (k === "important" || k === "personal") && !d[k]
          ? h("p", { class: "muted", style: "margin:6px 0" }, k === "important" ? "Not usually a critical or important function. " : "Usually no personal data. ",
              h("button", { type: "button", class: "link", id: `dm-${d.id}-${k}-add`, onclick: () => edit(() => { d[k] = k === "important" ? "work that large banks usually treat as supporting a critical or important function" : "names and contact details"; }) }, k === "important" ? "Mark it as one" : "Name the personal data"))
          : h("label", { style: "display:block;margin:6px 0" }, h("span", { class: "muted" }, label),
            h("textarea", { id: `dm-${d.id}-${k}`, rows: "2", class: changed("domains", d.id, k), oninput: (e) => editQuiet(() => { d[k] = k === "important" && !e.target.value.trim() ? null : e.target.value; }) }, d[k] || "")))));
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

  // ---------- areas: what someone is trying to do, each with a few sections. `pick` is the part of the configuration a
  // section edits: it drives the "changed" markers, the overview and the links from problems.
  const PARAMS = (groups, only) => (d) => (d.params || []).filter((p) => groups.includes(p.group || "Other") && (!only || only(p)));
  const QUALITY_SIMPLE = (p) => (p.group || "Other") === "Text limits" || p.key === "qualityMin";
  const QUALITY_GROUPS = ["Text limits", "Quality score", "Answer checks"];
  // where a setting is edited: routing thresholds, category matching (with the category rules), or description and quality
  const paramPlace = (p) => (p.group || "Other") === "Routing" ? { area: "routing", section: "thresholds" } : p.group === "Category matching" ? { area: "routing", section: "categories" } : { area: "conversation", section: "quality", advanced: !QUALITY_SIMPLE(p) };
  const AREAS = [
    { key: "routing", label: "Routing", blurb: "Where a request goes: the catalogue, an existing contract, business-led or procurement-led demand, and what happens next.",
      sections: [
        { key: "thresholds", label: "Thresholds", effect: "Which channel the route card recommends, which questions the chat asks for it, and the material spend review.", pick: PARAMS(["Routing"]), render: () => thresholds(["Routing"]) },
        { key: "channels", label: "Channels and next steps", effect: "The channel names and working days on the route card and in the chat, the tight-timeline warning, and the next steps listed on the route card.", pick: (d) => [d.channels, d.next_steps], render: () => h("div", {}, channels(), nextsteps()) },
        { key: "categories", label: "Category matching and rules", effect: "Which Level 4 categories the chat offers after the first message and whether a request may include more than one; who leads new demand between the two thresholds, and whether a renewal goes through the renewals calendar \u2014 the category card, the route card and its reason. The matching scores each category's name, search words and description against the request's words (the subject counts most); the AI adds its own pick; every category at the match below is offered, within the fewest and most shown.", pick: (d) => [PARAMS(["Category matching"])(d), (d.categories || []).map((c) => [c.id, c.name, c.cm_mandatory, c.renewals_calendar])], render: () => h("div", {}, thresholds(["Category matching"]), categories()) },
        { key: "rules", label: "Routing rules", effect: "The route the card recommends and the reason it gives (\"Why\"), with \"Based on\" naming the rule and its policy.", pick: (d) => (d.rules || []).filter((r) => !isFlagRule(r)), render: () => rules(false) }] },
    { key: "checks", label: "Checks and reviews", blurb: "The review flags a request raises, what they say and who reviews them, and the lists and offices they name.",
      sections: [
        { key: "flags", label: "Review flags", effect: "The \"Checks and reviews\" on the route card, in the record and in the service description: when each appears, what it says, how it is shown and who reviews it.", pick: (d) => (d.rules || []).filter(isFlagRule), render: () => rules(true) },
        { key: "lists", label: "Review lists", effect: "Which services and countries raise the prohibited-service and country-review flags on the route card.", pick: (d) => d.lists, render: reviewLists },
        { key: "divisions", label: "Divisions and vendor offices", effect: "The division question for new demand, the vendor office named in the flags and the record, and which ownership questions are asked.", pick: (d) => d.divisions, render: divisions },
        { key: "entities", label: "Legal entities", effect: "How the chat recognises the legal entity, the entity answer buttons, the offshoring check and the data transfer check.", pick: (d) => d.entities, render: entities }] },
    { key: "conversation", label: "Conversation", blurb: "What the chat asks and suggests, the welcome screen, and how the description is checked.",
      sections: [
        { key: "questions", label: "Questions", effect: "The wording of the questions, examples, reasons and answer buttons in the chat, and the labels in the side panel and the record.", pick: (d) => d.questions, render: questions },
        { key: "guidance", label: "Guidance by category", effect: "The examples and suggested answers the chat offers for each category (marked as built from category guidance).", pick: (d) => d.guidance, render: guidance },
        { key: "domains", label: "Operations domains", effect: "How the chat recognises the kind of operations work, and the examples and suggested answers it offers for it; the record-keeping and critical-function flags.", pick: (d) => d.domains, render: domains },
        { key: "examples", label: "Welcome examples", effect: "The example requests on the chat's welcome screen.", pick: (d) => d.examples, render: examples },
        { key: "quality", label: "Description and quality", effect: "The length limits of the service description, the follow-up checks on implausible answers, and the quality score before submitting.", pick: PARAMS(QUALITY_GROUPS),
          render: () => h("div", {}, S.advanced ? null : h("div", { class: "card" }, h("p", { class: "hint", style: "margin:0" }, "The quality-score weights, the answer checks and the Level 4 match are advanced settings: switch on \"Show advanced settings\" at the top to see them.")),
            thresholds(QUALITY_GROUPS, S.advanced ? null : QUALITY_SIMPLE)) }] },
    { key: "reference", label: "Reference data", blurb: "The lists the rules look things up in: Level 4, suppliers, framework contracts, the catalogue and the category search words.",
      sections: [
        { key: "l4", label: "Level 4", effect: "The Level 4 choices offered after the first message, and the category that decides the questions.", ref: "l4", render: () => reference("l4") },
        { key: "suppliers", label: "Suppliers", effect: "The preferred suppliers suggested in the chat and the non-preferred supplier flag.", ref: "suppliers", render: () => reference("suppliers") },
        { key: "contracts", label: "Contracts", effect: "Whether a request becomes a call-off on an existing contract, and the contract named on the route card.", ref: "contracts", render: () => reference("contracts") },
        { key: "catalogue", label: "Catalogue", effect: "Whether a request becomes a catalogue order, and the items or shop named on the route card.", ref: "catalogue", render: () => reference("catalogue") },
        { key: "words", label: "Category search words", effect: "Which category the chat proposes from the words of the request.", pick: (d) => (d.categories || []).map((c) => [c.id, c.keywords]), render: categoryWords }] },
    { key: "history", label: "History", blurb: "Published versions, the change log, and which rules decided submitted requests.",
      sections: [
        { key: "versions", label: "Versions and changes", render: versions },
        { key: "decisions", label: "Decision log", render: decisions }] },
  ];
  const areaOf = (k) => AREAS.find((a) => a.key === k);
  const sectionOf = (a, k) => (areaOf(a) || { sections: [] }).sections.find((x) => x.key === k);
  // a section differs from what was saved (unsaved) or from what is published (not yet published)
  function sectionState(sec) {
    if (sec.ref) return { unsaved: !same(S.doc[sec.ref], S.st.draft[sec.ref]), unpublished: (S.st.changed_ref || []).includes(sec.ref) };
    if (!sec.pick) return { unsaved: false, unpublished: false };
    return { unsaved: !same(sec.pick(S.doc), sec.pick(S.st.draft)), unpublished: !!S.st.published && !same(sec.pick(S.st.draft), sec.pick(S.st.published)) };
  }
  const isChanged = (sec) => { const x = sectionState(sec); return x.unsaved || x.unpublished; };

  // where a problem can be fixed
  function problemPlace(text) {
    const m = /^(R\d\d)\b/.exec(text);
    if (m) return { area: ROUTING.includes(m[1]) ? "routing" : "checks", section: ROUTING.includes(m[1]) ? "rules" : "flags", focus: "rule-" + m[1] };
    const param = S.doc.params.find((p) => text.startsWith(p.label + ":"));
    if (param) return { ...paramPlace(param), focus: "p-" + param.key };
    if (/^(Level 4 candidates shown|Level 4 matching|additional categories):/.test(text)) return { area: "routing", section: "categories" };
    const by = [[/^(The sourcing request form threshold|threshold)/, "routing", "thresholds"], [/^(Channel|next steps)/i, "routing", "channels"], [/^Division/, "checks", "divisions"], [/^legal entity/, "checks", "entities"],
      [/, entry \d+: needs a name/, "checks", "lists"], [/^operations domain/, "conversation", "domains"], [/^welcome examples/, "conversation", "examples"], [/^(headline|executive description)/, "conversation", "quality"],
      [/^(typical day rate|quality)/, "conversation", "quality", true], [/^Level 4/, "reference", "l4"], [/^Supplier/, "reference", "suppliers"], [/^Contract/, "reference", "contracts"], [/^Catalogue/, "reference", "catalogue"]];
    const hit = by.find(([re]) => re.test(text));
    return hit ? { area: hit[1], section: hit[2], advanced: !!hit[3] } : null;
  }

  // go to a section, optionally to one setting in it
  function go(place) {
    if (!place) return;
    S.area = place.area; S.section = place.section || (areaOf(place.area) && areaOf(place.area).sections.length ? areaOf(place.area).sections[0].key : "");
    if (place.advanced && !S.advanced) setAdvanced(true);
    Object.assign(S, place.state || {});
    S.search = "";
    if (S.area === "history") { delete S.extra.audit; delete S.extra.decisions; }
    try { history.replaceState(null, "", "#" + S.area + (S.section ? "/" + S.section : "")); } catch (e) { /* not allowed */ }
    render(); window.scrollTo(0, 0);
    if (place.focus) setTimeout(() => { const el = document.getElementById(place.focus); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus(); } }, 0);
  }
  function setAdvanced(on) { S.advanced = on; try { localStorage.setItem("adm-advanced", on ? "1" : "0"); } catch (e) { /* private window */ } }
  function fromHash() {
    const [a, sec] = String(location.hash || "").replace(/^#/, "").split("/");
    if (a === "overview" || !areaOf(a)) { S.area = "overview"; S.section = ""; return; }
    S.area = a; S.section = sectionOf(a, sec) ? sec : areaOf(a).sections[0].key;
  }

  // ---------- search: every setting by its name and texts
  function searchIndex() {
    const out = [], add = (area, section, label, text, focus, extra) => out.push({ area, section, label, hay: `${label} ${text || ""}`.toLowerCase(), focus, ...extra });
    S.doc.params.forEach((p) => { const w = paramPlace(p); add(w.area, w.section, p.label, `${p.group} ${p.description}`, "p-" + p.key, w.advanced ? { advanced: true } : undefined); });
    S.doc.channels.forEach((c) => add("routing", "channels", `Channel: ${c.name}`, c.key, `c-${c.key}-name`));
    S.doc.next_steps.forEach((n) => add("routing", "channels", `Next steps: ${n.label}`, n.steps.join(" "), `ns-${n.key}-0`));
    S.doc.categories.forEach((c) => { add("routing", "categories", `Category: ${c.name}`, c.id, `cat-${c.id}-name`); add("reference", "words", `Search words: ${c.name}`, (c.keywords || []).join(" "), `cat-${c.id}-kw`); });
    S.doc.rules.forEach((r) => add(isFlagRule(r) ? "checks" : "routing", isFlagRule(r) ? "flags" : "rules", `${r.id} ${r.name}`, [r.decides, r.step, ...r.outcomes.map((o) => [o.label, o.title, o.owner].join(" ")), ...r.rows.map((x) => x.text || "")].join(" "), "rule-" + r.id, { state: { ruleStep: "" } }));
    S.doc.lists.forEach((l) => add("checks", "lists", l.label, l.items.map((i) => `${i.name} ${i.keywords.join(" ")}`).join(" "), "list-" + l.key));
    S.doc.divisions.forEach((d) => add("checks", "divisions", `Division: ${d.name}`, d.vendor_office, `d-${d.id}-name`));
    S.doc.entities.forEach((e) => add("checks", "entities", `Legal entity: ${e.name}`, `${e.id} ${e.country} ${e.keywords.join(" ")} ${e.codes.join(" ")}`, `en-${e.id}-name`));
    S.doc.questions.forEach((q) => add("conversation", "questions", `Question: ${q.label}`, `${q.key} ${q.q || ""} ${q.ex || ""} ${(q.choices || []).join(" ")}`, `q-${q.key}-label`, { state: { qFilter: "" } }));
    S.doc.guidance.forEach((g) => add("conversation", "guidance", `Guidance: ${g.label}`, g.description, "gKey", { state: { gKey: g.key } }));
    S.doc.domains.forEach((d) => add("conversation", "domains", `Domain: ${d.name}`, d.keywords.join(" "), `dm-${d.id}-name`, { state: { dKey: d.id } }));
    S.doc.examples.forEach((x, i) => add("conversation", "examples", `Welcome example: ${x.label}`, x.text, `ex-${i}`));
    Object.entries(REF).forEach(([k, r]) => add("reference", k, r.label, "csv upload download", `ref-${k}-download`));
    return out;
  }
  function searchResults() {
    const words = S.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const hits = searchIndex().filter((x) => words.every((w) => x.hay.includes(w))).sort((a, b) => Number(b.label.toLowerCase().includes(words[0])) - Number(a.label.toLowerCase().includes(words[0]))).slice(0, 10);
    return h("div", { class: "results", id: "results", role: "listbox" }, hits.length ? hits.map((x) => h("button", { type: "button", class: "result", role: "option", onclick: () => go(x) },
      h("b", {}, x.label), h("span", { class: "muted" }, ` ${areaOf(x.area).label} › ${sectionOf(x.area, x.section).label}${x.advanced ? " (advanced)" : ""}`))) : h("div", { class: "muted", style: "padding:8px" }, "Nothing found."));
  }

  // ---------- overview: one card per area, then common tasks
  function overview() {
    const prob = problems().map(problemPlace), latest = S.st.versions[0];
    const TASKS = [["Change a threshold", { area: "routing", section: "thresholds" }], ["Change what a review flag says or who reviews it", { area: "checks", section: "flags" }], ["Update a review list", { area: "checks", section: "lists" }],
      ["Change the next steps", { area: "routing", section: "channels" }], ["Change a question or its answer buttons", { area: "conversation", section: "questions" }], ["Upload new framework contracts", { area: "reference", section: "contracts" }]];
    return h("div", {},
      h("p", { class: "hint" }, latest ? `Live: version ${latest.version}, published ${when(latest.published_at)} by ${latest.actor}${latest.note ? ` (${latest.note})` : ""}.` : "Nothing has been published yet: the page runs on the built-in configuration."),
      h("div", { class: "areas" }, AREAS.map((a) => {
        const changedSecs = a.sections.filter(isChanged), np = prob.filter((x) => x && x.area === a.key).length;
        return h("div", { class: "card area", "data-overview": a.key }, h("h2", {}, h("button", { type: "button", class: "link", onclick: () => go({ area: a.key }) }, a.label)), h("p", { class: "hint" }, a.blurb),
          a.key === "history" ? null : h("p", {}, changedSecs.length ? h("span", { class: "pill warn" }, `${changedSecs.length} section${changedSecs.length > 1 ? "s" : ""} changed, not yet published`) : h("span", { class: "pill" }, "No changes"),
            np ? h("span", { class: "pill bad", style: "margin-left:6px" }, `${np} problem${np > 1 ? "s" : ""}`) : null),
          h("div", { class: "secs" }, a.sections.map((x) => h("button", { type: "button", class: "btn s", onclick: () => go({ area: a.key, section: x.key }) }, x.label, isChanged(x) ? h("span", { class: "dot", title: "changed" }) : null))));
      })),
      h("div", { class: "card" }, h("h2", {}, "Common tasks"), h("ul", { class: "tasks" }, TASKS.map(([label, place]) => h("li", {}, h("button", { type: "button", class: "link", onclick: () => go(place) }, label))))));
  }

  // ---------- page
  function render() {
    const y = window.scrollY, active = document.activeElement && document.activeElement.id;
    $app.replaceChildren();
    if (!S.st) { $app.append(login()); return; }
    const prob = problems(), area = areaOf(S.area), sec = area && (sectionOf(S.area, S.section) || area.sections[0]);
    if (sec) S.section = sec.key;
    const body = area ? h("div", {}, sec.effect ? h("p", { class: "effect", "data-effect": `${area.key}/${sec.key}` }, h("b", {}, "What this changes in the chat: "), sec.effect) : null, sec.render()) : overview();
    const nav = (key, label, changedNow) => h("button", { class: "tab", type: "button", "aria-current": S.area === key ? "page" : null, "data-area": key, onclick: () => go({ area: key }) }, label, changedNow ? h("span", { class: "dot", title: "changed" }) : null);
    $app.append(
      h("header", { class: "top" }, h("h1", {}, "Rules and settings"), h("span", { class: "muted", style: "color:#d6deef" }, S.actor ? `Signed in as ${S.actor}` : ""), h("span", { class: "sp" }),
        h("div", { class: "search" }, h("input", { type: "search", id: "search", placeholder: "Find a setting", "aria-label": "Find a setting", value: S.search, oninput: (e) => { S.search = e.target.value; const old = document.getElementById("results"); const r = searchResults(); if (old) old.remove(); if (r) e.target.parentNode.append(r); } }), S.search ? searchResults() : null),
        h("label", { class: "adv" }, h("input", { type: "checkbox", id: "advanced", checked: S.advanced, onchange: (e) => { setAdvanced(e.target.checked); render(); } }), " Show advanced settings"),
        h("a", { href: "./" }, "Open the intake"), h("button", { class: "btn s", type: "button", onclick: () => { if (S.unsaved && !confirm("Leave without saving?")) return; S.code = ""; sessionStorage.removeItem("adm"); S.st = null; S.extra = {}; render(); } }, "Sign out")),
      h("main", { class: "wrap" }, statusBar(),
        S.error ? h("div", { class: "problems", role: "alert" }, S.error) : null,
        prob.length ? h("div", { class: "problems", id: "problems" }, h("b", {}, "Fix these before publishing"), h("ul", {}, prob.slice(0, 12).map((p) => { const place = problemPlace(p); return h("li", {}, p, place ? [" ", h("button", { type: "button", class: "link", onclick: () => go(place) }, `Go to ${areaOf(place.area).label} › ${sectionOf(place.area, place.section).label}`)] : null); }))) : null,
        h("nav", { class: "tabs areas-nav", "aria-label": "Areas" }, nav("overview", "Overview"), AREAS.map((a) => nav(a.key, a.label, a.sections.some(isChanged)))),
        area ? h("nav", { class: "sections", "aria-label": `${area.label} sections` }, area.sections.map((x) => h("button", { class: "sec", type: "button", "aria-current": x.key === sec.key ? "page" : null, "data-section": `${area.key}/${x.key}`, onclick: () => go({ area: area.key, section: x.key }) }, x.label, isChanged(x) ? h("span", { class: "dot", title: "changed" }) : null))) : null,
        body));
    window.scrollTo(0, y);
    if (active) { const el = document.getElementById(active); if (el) { el.focus(); if (el.id === "search" && el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); } }
  }
  window.addEventListener("hashchange", () => { if (S.st) { fromHash(); render(); } });
  window.addEventListener("beforeunload", (e) => { if (S.unsaved) { e.preventDefault(); e.returnValue = ""; } });

  (async () => {
    fromHash();
    if (S.code) { try { take(await api("GET")); } catch (e) { S.code = ""; sessionStorage.removeItem("adm"); } }
    render();
  })();
})();
