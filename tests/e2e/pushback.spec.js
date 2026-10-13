// Behaviour found in a live AI test (October 2026): requesters push back, ask questions back, add side remarks,
// answer in a word or ask for suggestions. Nothing of that may end up as an answer. Offline rules mode.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, choices } = require("./helpers");

const DINNER = "An agency for a client dinner for 40 people, around 30k.";
const CONSULTING = "We need business consultants to redesign our procurement operating model, about 200k for 6-12 months";
const msgsSince = (page, n) => page.evaluate((n) => S.msgs.slice(-n).map((m) => m.text || "").join("\n"), n);

test("'why do you need that?' is answered with the reason, nothing is recorded and the question comes back", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, DINNER);
  expect(await page.evaluate(() => S.lastAsked)).toBe("background");
  await say(page, "why do you need that?");
  const last = await msgsSince(page, 1);
  expect(last).toMatch(/^Good question\. The problem and what a delay would cost/);
  expect(last).toMatch(/What business problem does this solve/);
  expect(await page.evaluate(() => [S.f.background, S.lastAsked, S.asked.background || 0])).toEqual([null, "background", 0]);   // a question back is no attempt
  expect(errors).toEqual([]);
});

test("'what would you suggest?' gets a suggestion that can be accepted in one tap", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "what would you suggest?");
  await expect(lastAssistant(page)).toContainText("Here's a common answer you can start from");   // offline: the question's example
  expect(await choices(page).allInnerTexts()).toContain("Use this suggestion");
  expect(await page.evaluate(() => S.f.background)).toBeNull();
  await choose(page, "Use this suggestion");
  expect(await page.evaluate(() => S.f.background)).toMatch(/client event keeps key relationships warm/);
});

test("pushback on the route explains it and offers the options; the question stays open", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "we don't want three quotes, can we just book a restaurant directly?");
  const last = await msgsSince(page, 1);
  expect(last).toMatch(/under the €50,000 threshold/);
  expect(last).toMatch(/single source/);
  expect(await page.evaluate(() => S.f.background)).toBeNull();
});

test("'why does that matter?' on a closed question keeps its answer buttons and records nothing", async ({ page }) => {
  await openApp(page);
  await say(page, CONSULTING);
  await choose(page, "No, look wider");
  for (let i = 0; i < 30 && (await page.evaluate(() => S.lastAsked)) !== "budget_approved"; i++) {
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion");
    else if (chips.length && !chips.includes("Skip for now")) await choose(page, chips[0]);
    else await say(page, "A target operating model and a rollout plan, because buying is slow and costly; if delayed we miss savings");
  }
  await say(page, "why does that matter?");
  await expect(lastAssistant(page)).toContainText("Sourcing only starts once the budget is confirmed");
  expect(await choices(page).allInnerTexts()).toEqual(["Yes", "Not yet", "Partly"]);
  expect(await page.evaluate(() => S.f.budget_approved)).toBeNull();
});

test("side remarks and a separate purchase are kept out of the answer, and the chat says so", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "Client dinners keep our relationships warm. btw our CFO loves jazz");
  expect(await page.evaluate(() => S.f.background)).not.toMatch(/jazz/i);
  expect(await msgsSince(page, 6)).toContain(`I've kept "our CFO loves jazz" out of this answer`);
  // the profile suggestion is accepted, the laptops are a separate request
  await say(page, "yes. also we need 10 laptops for the new team");
  const notes = await msgsSince(page, 6);
  expect(notes).toContain("10 laptops for the new team is a separate purchase (IT hardware)");
  expect(await page.evaluate(() => JSON.stringify(S.f))).not.toMatch(/laptops/);
});

test("a budget change mentioned in passing is applied and said out loud", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "Client dinners keep our relationships warm. oh and the budget is now 40k");
  expect(await msgsSince(page, 10)).toContain("Changed: budget from €30,000 to **€40,000**");
  expect(await page.evaluate(() => S.f.background)).not.toMatch(/40k/);
});

test("'ok' in reply to 'say a little more' keeps the first answer; a past start is not kept but left to be agreed", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "slow");
  await expect(lastAssistant(page)).toContainText("Could you say a little more?");
  await say(page, "ok");
  expect(await page.evaluate(() => S.f.background)).toMatch(/^slow$/i);
  // a start that has passed can't be planned
  await page.click("#newBtn");
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await say(page, "by 1 October 2026");
  await expect(lastAssistant(page)).toContainText("seems to be in the past");
  await say(page, "it's fine, keep it");
  expect(await page.evaluate(() => S.f.needed_by)).toBe("To be determined");
  expect(await msgsSince(page, 8)).toContain("A start of 1 October 2026 has already passed");
});

test("'Excel' is asked for the missing half; a timing check is never dropped by the limit of three checks", async ({ page }) => {
  await openApp(page);
  await say(page, CONSULTING);
  await choose(page, "No, look wider");
  for (let i = 0; i < 12 && (await page.evaluate(() => S.lastAsked)) !== "current_solution"; i++) {
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion");
    else if (chips.length && !chips.includes("Skip for now")) await choose(page, chips[0]);
    else await say(page, "Buying is slow and costly; if delayed we miss savings this year");
  }
  await say(page, "Excel");
  await expect(lastAssistant(page)).toContainText("Thanks, so today it's Excel. And why can't that, or our own team, do the job?");
  await say(page, "nobody here has done an operating model redesign");
  for (let i = 0; i < 30 && (await page.evaluate(() => S.lastAsked)) !== "needed_by"; i++) {
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion");
    else await say(page, "A current-state assessment, a target operating model and a rollout plan");
  }
  await page.evaluate(() => { S.challengeCount = 3; });
  await say(page, "asap");
  await expect(lastAssistant(page)).toContainText("usually takes 30–60 working days");
});

test("rules behind the findings: suppliers, entities, data location, officials, offshoring, domains, wording", async ({ page }) => {
  await openApp(page);
  await say(page, CONSULTING);
  const got = await page.evaluate(() => {
    const r = {};
    S.f.supplier = "Lakeshore Advisory and Blue Yonder Partners";
    r.nonPreferred = controlsFor("sourcing", null).some((c) => c[1] === "Non-preferred supplier");
    r.workday = cleanSupplier("Workday maybe");
    S.f.supplier = "Workday"; S.f.supplier_reason = "market leader I guess, but happy to compare";
    r.sole = soleSupplier(S.f);
    r.unknownSupplier = hasSupplier({ supplier: "unknown" });
    r.german = readAnswer("entity", "the german one");
    r.noEntity = readAnswer("entity", "the big one");
    r.budget = readAnswer("budget_approved", "no idea");
    r.cloud = saysWhere("cloud");
    r.euCloud = saysWhere("in the EU cloud");
    r.officials = (() => { const m = S.msgs; S.msgs = [{ role: "user", text: "client dinner, maybe someone from the finance ministry" }]; const f = { ...S.f, category: "marketing" }; const x = bankChecks(f).find((c) => c[1] === "Gifts and hospitality approval"); S.msgs = m; return x && x[0]; })();
    r.aml = (() => { const m = S.msgs; S.msgs = [{ role: "user", text: "Consultants for procurement. AML has nothing to do with this" }]; const d = bankDomain({ category: "consulting" }); S.msgs = m; return d && d.id; })();
    r.hrSystem = (() => { const m = S.msgs; S.msgs = [{ role: "user", text: "new HR system" }]; const d = bankDomain({ category: "software" }); S.msgs = m; return d && d.id; })();
    r.payroll = (() => { const m = S.msgs; S.msgs = [{ role: "user", text: "A new HR system to replace our payroll tool." }]; const d = bankDomain({ category: "software" }); S.msgs = m; return d && d.id; })();
    r.onSite = (() => { const f = { ...BLANK_FACTS, entity: "UK", location: "Mostly remote, sometimes on site in Frankfurt" }; deriveFacts(f); return f.offshore; })();
    r.placeholders = tidySuggestion("kpis_pack", "Success measures: Reduced procurement cycle time by X%; Y% cost savings; better stakeholder satisfaction");
    r.k = ACCEPT.test("k");
    r.none = NO_BENEFIT.test("none");
    // after a route change, a question whose lines the accepted profile already gave is not asked again
    r.profileCovers = (() => { const f0 = { ...S.f }; Object.assign(S.f, { users: "Clients", functions: "Marketing", benefits: "Stronger relationships", reg_benefits: "None" }); refresh(); const m = S.missing.slice(); Object.assign(S.f, f0); refresh(); return m.includes("audience_fn") || m.includes("value_props"); })();
    S.flags.push({ fact: "must_haves", issue: "The user asked a question about what other banks need, but the system is asking for the must-haves.", status: "confirmed" });
    r.quality = computeQuality([]).points.map((p) => p.text).find((t) => /^Must-haves/.test(t));
    return r;
  });
  expect(got).toEqual({
    nonPreferred: false, workday: "Workday", sole: false, unknownSupplier: false, german: "EU", noEntity: null, budget: "unsure",
    cloud: false, euCloud: true, officials: "w", aml: null, hrSystem: null, payroll: "hrops", onSite: null,
    placeholders: "Success measures: Reduced procurement cycle time; cost savings; better stakeholder satisfaction", k: true, none: true, profileCovers: false,
    quality: "Must-haves: needed a second look. Confirmed by you, so the buyer may ask again.",
  });
});

test("at the check step, 'why is this outsourcing?' is answered with the reasons and the check is shown again", async ({ page }) => {
  await openApp(page);
  await say(page, "KYC periodic reviews for our corporate clients by an external provider for 2 years, around 600k.");
  await page.evaluate(() => { for (const k of S.missing.filter((x) => x !== "confirm_derived")) S.f[k] = bundleOf(k) ? "Confirmed" : "Not given"; S.f.in_house = true; refresh(); S.lastAsked = "confirm_derived"; });
  await say(page, "why is this outsourcing?");
  const last = await msgsSince(page, 1);
  expect(last).toMatch(/^Outsourcing: Outsourcing \(likely\)\. It is performed on an ongoing basis/);
  expect(last).toContain("Here's what I've worked out from your answers");
  expect(await page.evaluate(() => S.f.confirm_derived)).toBeNull();
});

test("while a check is open, a question back still works and the check stays open; the framework question has its own reason", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "slow");
  await expect(lastAssistant(page)).toContainText("Could you say a little more?");
  await say(page, "what would you suggest?");
  await expect(lastAssistant(page)).toContainText("Here's a common answer you can start from");
  expect(await page.evaluate(() => S.f.background)).not.toMatch(/suggest/);
  await choose(page, "Use this suggestion");
  expect(await page.evaluate(() => S.f.background)).toMatch(/client event keeps key relationships warm/);
  // "why would I use them?" on the framework question
  await page.click("#newBtn");
  await say(page, CONSULTING);
  await say(page, "why would I use them? are they even any good at procurement?");
  const last = await lastAssistant(page).innerText();
  expect(last).toContain("The framework was put out to competition before");
  expect(last).not.toContain("skip it for now");
  expect(await choices(page).allInnerTexts()).toEqual(["Yes, use it", "No, look wider"]);
  await choose(page, "No, look wider");
  expect(await page.evaluate(() => S.det.why)).toMatch(/^This is new demand \(you chose to look wider than the existing framework\)\./);
});

test("from the repeated live run: skip during a check, invented figures, supplier and data wording, offshoring phrases", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "slow");
  await expect(lastAssistant(page)).toContainText("Could you say a little more?");
  await say(page, "skip");
  expect(await page.evaluate(() => S.f.background)).toMatch(/^slow$/i);   // "skip" keeps the first answer, it is not the answer
  const got = await page.evaluate(() => {
    const r = {};
    r.offshore = (() => { const f = { ...BLANK_FACTS, entity: "UK", location: "Mostly remote, with occasional on-site work in Frankfurt. The team sits in London and Singapore." }; deriveFacts(f); return f.offshore; })();
    r.supplier = cleanSupplier("Lakeshore Advisory and Blue Yonder Partners (competition)");
    r.terms = normFact("supplier_terms", false);
    r.data = normFact("data_details", "Some spend data probably");
    r.reply = cleanReply("Here's a typical setup: **Operations hub in a low-cost country; trained staff.");
    S.f.demand_type = "software"; S.f.category = "software";
    r.sg = tidySuggestion("value_props", "Unique selling points: One platform for 12,000+ users across 50+ countries\nKey benefits: 80% reduction in manual data entry; call volumes cut by 40%; fewer errors\nRegulatory / governance benefits: Audit trails for every change");
    r.long = words(tidySuggestion("scope_out", Array.from({ length: 6 }, (_, i) => `exclusion number ${i} with several more words to make it long enough`).join("; ")));
    return r;
  });
  expect(got.offshore).toBeNull();
  expect(got.supplier).toBe("Lakeshore Advisory and Blue Yonder Partners");
  expect(got.terms).toBe("No");
  expect(got.data).toBe("Some spend data");
  expect(got.reply).not.toContain("**");
  expect(got.sg).not.toMatch(/\d/);
  expect(got.sg).toMatch(/^Unique selling points: One platform for users across countries\nKey benefits: reduction in manual data entry; call volumes cut; fewer errors\nRegulatory/);
  expect(got.long).toBeLessThanOrEqual(50);
});

test("from the consulting run: budget per consultant day, edits to suggestions, deadlines, padded answers, obligations, wording", async ({ page }) => {
  await openApp(page);
  await say(page, "I need three business consultants for a target operating model transformation in procurement for 9 months");
  await say(page, "80k");
  await expect(lastAssistant(page)).toContainText("€80,000 for 3 people over 9 months is about €148 a day each");
  await say(page, "Yes, that's the total");
  const got = await page.evaluate(() => {
    const r = {};
    const sg = "Sponsor and stakeholders: Procurement Director (sponsor), CFO (budget and savings oversight), Head of Risk (control impact)\nTeams involved: Procurement teams, Finance, Risk and Compliance";
    r.swap = editSuggestion(sg, "the CPO is the sponsor, not the Procurement Director. rest is fine");
    r.drop = editSuggestion("Success measures: Achieve the savings target by Q2 2027; deliver the target operating model design within 9 months; sponsor sign-off on all deliverables", "drop the savings amount, rest ok");
    r.noEdit = editSuggestion(sg, "no, those numbers are made up and we just want lower cost");
    S.f.value = 80000;
    r.approved = screenAIFacts({ value: 50000, budget_approved: "partly" }, "budget_approved", "partly, 50k is approved so far");
    r.deadline = screenAIFacts({ needed_by: "Q2" }, "background", "The board wants a new target operating model by Q2 next year; if it slips we lose the savings target");
    r.padded = screenAIFacts({ current_solution: "Nobody internally has done an operating model redesign and the team is fully booked until next year" }, "current_solution", "nobody internally has done an operating model redesign and the team is busy with daily buying");
    r.shall = shallify("assess today's setup in 6 countries, design the target operating model incl. roles, governance and category management, build the business case, and a rollout plan");
    r.placeholder = tidySuggestion("kpis_pack", "Success measures: Achieve the savings target of €X million by Q2 2027; sponsor sign-off on all deliverables");
    r.tip = thinIssue("kpis_pack").message;
    r.lead = firstPerson("need three business consultants for a 9-month transformation");
    r.excl = normFact("scope_out", "Exclusions: Implementation of the new model; IT build");
    Object.assign(S.f, { kpis: "Model signed off by the CPO by June 2027; business case approved by Finance", acceptance: "Each deliverable accepted in writing" });
    r.kpis = offlineExec("a target operating model transformation").kpis;
    return r;
  });
  expect(got.swap).toBe("Sponsor and stakeholders: CPO (sponsor), CFO (budget and savings oversight), Head of Risk (control impact)\nTeams involved: Procurement teams, Finance, Risk and Compliance");
  expect(got.drop).toBe("Success measures: deliver the target operating model design within 9 months; sponsor sign-off on all deliverables");
  expect(got.noEdit).toBeNull();
  expect(got.approved).toEqual({ budget_approved: "partly" });
  expect(got.deadline).toEqual({});
  expect(got.padded).toEqual({});
  expect(got.shall).toEqual(["The Service Provider shall assess today's setup in 6 countries.", "The Service Provider shall design the target operating model including roles, governance and category management.",
    "The Service Provider shall build the business case.", "The Service Provider shall deliver a rollout plan."]);
  expect(got.placeholder).toBe("Success measures: Achieve the savings target by Q2 2027; sponsor sign-off on all deliverables");
  expect(got.tip).toContain("signed off by the sponsor");
  expect(got.lead).toBe("three business consultants for a 9-month transformation");
  expect(got.excl).toBe("Implementation of the new model; IT build");
  expect(got.kpis).toEqual(["Model signed off by the CPO by June 2027", "Business case approved by Finance"]);
});

test("'the CPO is the sponsor, not the Procurement Director. rest is fine' accepts the suggestion with that change", async ({ page }) => {
  await openApp(page);
  await say(page, "We need business consultants to redesign our procurement operating model, about 200k for 6-12 months");
  await choose(page, "No, look wider");
  for (let i = 0; i < 6 && (await page.evaluate(() => S.lastAsked)) !== "audience_fn"; i++) {
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion"); else if (chips.length && !chips.includes("Skip for now")) await choose(page, chips[0]); else await say(page, "Buying is slow and costly; if delayed we miss the savings target");
  }
  await page.evaluate(() => { S.suggest.audience_fn = "Sponsor and stakeholders: Procurement Director (sponsor), CFO\nTeams involved: Procurement, Finance and Risk"; });
  await say(page, "the CPO is the sponsor, not the Procurement Director. rest is fine");
  expect(await page.evaluate(() => [S.f.users, S.f.functions, S.sugAccepted.audience_fn])).toEqual(["CPO (sponsor), CFO", "Procurement, Finance and Risk", true]);
});
