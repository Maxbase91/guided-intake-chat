// Questions fit the kind of work: a project (consulting, legal, events, IT builds) is not asked product or running-service
// questions, a running service keeps service levels and governance, a product keeps its selling points. Bank checks show as flags.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, choices } = require("./helpers");

const GENERIC = [
  [/cost in total/i, "About 200k"], [/How long will the work run/i, "6-12 months"],
  [/business problem/i, "We lack the expertise internally; if delayed we miss our delivery timelines"],
  [/expertise or capacity is missing|use today|does this work today/i, "Our own team lacks the expertise and is fully booked"],
  [/must it be able to do/i, "Workflows and reporting; it works if 95% of cases close on time"],
  [/exactly must the provider do|supplier deliver/i, "Deliver the work as described, with a short report at each milestone"],
  [/When (?:do you need it|should it start)/i, "1 March 2027"], [/Where and how/i, "On our premises"], [/budget already approved/i, "Yes"],
  [/see or access any of our/i, "No access"], [/bank does itself today/i, "We could realistically do it"],
  [/Anything else/i, "Nothing else"], [/supplier in mind/i, "No preference"], [/supply or run any technology/i, "No"],
  [/how many items per month/i, "About 2,000 a month"],
];

// runs a conversation to the result cards; records the fact each question was about and the text shown
async function run(page, first, answers = []) {
  await say(page, first);
  const asked = [];
  for (let i = 0; i < 45; i++) {
    await idle(page);
    if (await page.locator("[data-act=submit]").count()) return asked;
    const key = await page.evaluate(() => S.missing[0] || "");
    const text = await lastAssistant(page).innerText();
    asked.push({ key, text });
    const hit = answers.find(([re]) => re.test(text));
    if (hit) { await say(page, hit[1]); continue; }
    const chips = await choices(page).allInnerTexts();
    const pick = ["Use this suggestion", "Yes, that's right", "No, look wider"].find((c) => chips.includes(c));
    if (pick) { await choose(page, pick); continue; }
    const g = GENERIC.find(([re]) => re.test(text));
    if (g) await say(page, g[1]);
    else if (chips.length) await choose(page, chips[0]);
    else throw new Error(`No scripted answer for: ${text}`);
  }
  throw new Error("Conversation did not finish");
}
const textOf = (asked, key) => (asked.find((a) => a.key === key) || {}).text || "";
const controls = (page) => page.evaluate(() => S.det.controls.map(([lvl, name, why]) => ({ lvl, name, why })));

test("consulting is a project: sponsor, outcomes and steering, never selling points, service levels or a support desk", async ({ page }) => {
  const errors = await openApp(page);
  // the case from a real run; a monthly status report does not make a project an ongoing service
  const asked = await run(page, "Consultancy support to fill a procurement knowledge gap, about 200k for 6-12 months, no technology involved.",
    [[/exactly must the provider do/i, "A current-state assessment and a target operating model, with a monthly status report"]]);
  expect(await page.evaluate(() => [S.det.route, S.f.category, kindOf(S.f), yes(S.f.tech_service)])).toEqual(["sourcing", "consulting", "project", false]);
  const keys = asked.map((a) => a.key), all = asked.map((a) => a.text).join("\n");
  expect(textOf(asked, "audience_fn")).toMatch(/Who sponsors this/);
  expect(textOf(asked, "audience_fn")).toContain("Sponsor and stakeholders:");
  expect(textOf(asked, "value_props")).toContain("Expected outcomes:");
  expect(textOf(asked, "kpis_pack")).toMatch(/How will you know the work succeeded/);
  expect(textOf(asked, "governance")).toMatch(/How should the project be steered/);
  expect(textOf(asked, "governance")).toContain("steering committee");
  expect(all).not.toMatch(/selling point|Which service levels|support model|service desk|managed, supported service/i);
  for (const k of ["service_model", "in_house", "tech_service"]) expect(keys).not.toContain(k);
  // EBA/GL/2019/02 paragraph 26: a project with set deliverables is not recurrent or ongoing
  const o = await page.evaluate(() => outsourcing(S.f));
  expect(o.result).toBe("Not outsourcing (likely)");
  expect(o.steps.find(([step]) => /recurrent or ongoing/.test(step))[1]).toBe("No, a one-off delivery");
  expect((await controls(page)).map((c) => c.name)).toContain("Auditor independence check");
  expect(await page.evaluate(() => S.sd.desc.usp || "")).toBe("");   // no "Unique selling points" row in the service summary
  expect(errors).toEqual([]);
});

test("the AI gets the project wording, the project lines and the kind of work", async ({ page }) => {
  await openApp(page);
  await say(page, "Consultancy support to fill a procurement knowledge gap, about 200k for 6-12 months, no technology involved.");
  await choose(page, "No, look wider");
  for (let i = 0; i < 6 && (await page.evaluate(() => S.missing[0])) !== "audience_fn"; i++) {
    const text = await lastAssistant(page).innerText();
    await say(page, (GENERIC.find(([re]) => re.test(text)) || [, "Nothing else"])[1]);
  }
  const got = await page.evaluate(() => ({ state: stateBlock(), system: chatSystem() }));
  expect(got.state).toContain('"lines":["Sponsor and stakeholders","Teams involved"]');
  expect(got.state).toContain("Who sponsors this, and which teams will work with the provider or use the result?");
  expect(got.system).toContain("Kind of work: a project with set deliverables");
  expect(got.system).not.toContain("Kind of work: a service");
});

test("legal advice asks who in Legal instructs the firm, with matter updates and the Legal flag", async ({ page }) => {
  await openApp(page);
  const asked = await run(page, "External counsel for a regulatory investigation, around 300k.");
  expect(await page.evaluate(() => [S.det.route, S.f.category, kindOf(S.f)])).toEqual(["sourcing", "legal", "project"]);
  expect(textOf(asked, "audience_fn")).toMatch(/who in Legal will instruct the firm/);
  expect(textOf(asked, "governance")).toContain("Matter update with our instructing lawyer");
  expect(asked.map((a) => a.text).join("\n")).not.toMatch(/selling point|Which service levels/i);
  expect((await controls(page)).map((c) => c.name)).toContain("Instructed through Legal");
});

test("a client event asks about guests and public officials, skips staff qualifications and flags gifts and hospitality", async ({ page }) => {
  await openApp(page);
  const asked = await run(page, "An agency for our annual client conference for 300 guests, around 400k.",
    [[/public officials/i, "About 300 clients and prospects, and a few public officials from the finance ministry"]]);
  expect(await page.evaluate(() => [S.f.category, kindOf(S.f)])).toEqual(["marketing", "project"]);
  expect(textOf(asked, "audience_fn")).toMatch(/Who will be invited, roughly how many guests, and will any of them be public officials/);
  expect(asked.map((a) => a.key)).not.toContain("qualifications");
  const gifts = (await controls(page)).find((c) => c.name === "Gifts and hospitality approval");
  expect(gifts.lvl).toBe("w");
  expect(gifts.why).toMatch(/Public officials may attend/);
});

test("a client dinner under the threshold gets the project profile: guests, outcomes and success measures", async ({ page }) => {
  await openApp(page);
  const asked = await run(page, "An agency for a client dinner for 40 people, around 30k.");
  expect(await page.evaluate(() => S.det.route)).toBe("quote");
  const profile = textOf(asked, "profile");
  for (const line of ["Guests:", "Hosting teams:", "Expected outcomes:", "Success measures:"]) expect(profile).toContain(line);
  expect(profile).not.toMatch(/Target audience|selling point/i);
  expect((await controls(page)).find((c) => c.name === "Gifts and hospitality approval").lvl).toBe("i");
});

test("market data asks how the data is used, keeps the product wording and flags the licence", async ({ page }) => {
  await openApp(page);
  const asked = await run(page, "An ESG ratings data feed for our research team, around 120k a year.");
  expect(await page.evaluate(() => [S.f.category, kindOf(S.f)])).toEqual(["market-data", "product"]);
  expect(textOf(asked, "audience_fn")).toMatch(/on screens, in applications or models, or passed on to clients/);
  expect(textOf(asked, "value_props")).toContain("Unique selling points:");
  expect((await controls(page)).map((c) => c.name)).toContain("Data licence check");
});

test("an ongoing operations service keeps service levels and governance, without selling points", async ({ page }) => {
  await openApp(page);
  const asked = await run(page, "KYC periodic reviews for our corporate clients by an external provider for 2 years, around 600k.");
  expect(await page.evaluate(() => [S.f.category, kindOf(S.f)])).toEqual(["bpo", "service"]);
  expect(textOf(asked, "audience_fn")).toMatch(/Who relies on this service/);
  expect(textOf(asked, "value_props")).toContain("Key benefits:");
  expect(textOf(asked, "value_props")).not.toContain("Unique selling points");
  expect(textOf(asked, "kpis_pack")).toMatch(/Which service levels and KPIs should apply/);
  expect(textOf(asked, "kpis_pack")).toContain("Service levels:");
  expect(textOf(asked, "governance")).toMatch(/How should the service be governed/);
  expect(await page.evaluate(() => outsourcing(S.f).result)).toBe("Outsourcing (likely)");
});

test("bank categories: app builds, security testing, audit and tax, recruitment, print and mail", async ({ page }) => {
  await openApp(page);
  const CASES = [
    ["Develop a new client onboarding app for our retail bank, about 800k.", "it-services", "project"],
    ["A penetration test of our mobile banking app, around 120k.", "it-services", "project"],
    ["Tax advice on transfer pricing for our German entity, around 80k.", "audit-tax", "project"],
    ["Statutory audit of our 2027 accounts, around 2 million.", "audit-tax", "project"],
    ["Executive search for a chief risk officer, around 150k.", "hr-services", "project"],
    ["A SaaS app to track travel expenses, around 40k.", "software", "product"],
    ["Statement printing and mailing for our retail clients for 3 years, around 900k.", "bpo", "service"],
    ["Screening lists data for onboarding, 120k per year.", "market-data", "product"],
    ["A third-party risk data provider for supplier screening, around 300k.", "market-data", "product"],
  ];
  const got = [];
  for (const [first] of CASES) {
    await page.click("#newBtn");
    await say(page, first);
    got.push(await page.evaluate(() => [S.f.category, kindOf(S.f)]));
    const extra = await page.evaluate(() => ({ req: requiredFor("sourcing", S.f), qual: offlineSuggest("qualifications"), out: outsourcing(S.f).ex || "", ctl: S.det.controls.map((c) => c[1]) }));
    if (/onboarding app/.test(first)) { expect(extra.req).not.toContain("volume"); expect(extra.qual).not.toMatch(/ACAMS|due diligence/); }
    if (/penetration/.test(first)) expect(extra.req).not.toContain("service_model");
    if (/Statutory audit/.test(first)) expect(extra.out).toMatch(/28\(a\)/);
    if (/audit|Tax advice/.test(first)) expect(extra.ctl).toContain("Auditor independence check");
  }
  expect(got).toEqual(CASES.map(([, cat, kind]) => [cat, kind]));
});

// answers until the given question is next; suggestions are accepted
async function until(page, key) {
  for (let i = 0; i < 20; i++) {
    await idle(page);
    if ((await page.evaluate(() => S.missing[0])) === key && (await page.evaluate(() => S.lastAsked)) === key) return;
    const text = await lastAssistant(page).innerText(), chips = await choices(page).allInnerTexts();
    const pick = ["Use this suggestion", "No, look wider"].find((c) => chips.includes(c));
    if (pick) { await choose(page, pick); continue; }
    const g = GENERIC.find(([re]) => re.test(text));
    if (g) await say(page, g[1]); else await choose(page, chips[0]);
  }
  throw new Error(`Never asked ${key}`);
}
const CONSULTING = "Consultancy support to fill a procurement knowledge gap, about 200k for 6-12 months, no technology involved.";

test("'use example given' answers with the example the question showed, never the words themselves", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, CONSULTING);
  await until(page, "scope_in");
  await say(page, "use example given");
  const got = await page.evaluate(() => ({ scope: S.f.scope_in, shown: S.msgs.filter((m) => m.role === "user").pop().text, obligations: S.msgs.filter((m) => /written this as obligations/.test(m.text || "")).pop().text }));
  expect(got.scope).toMatch(/current-state process map/i);
  expect(got.shown).toBe("use example given");   // the chat shows what was typed
  expect(got.obligations).not.toMatch(/use example/i);
  expect(got.obligations).toMatch(/The Service Provider shall/);
  // the example in the AI's own wording is found too
  expect(await page.evaluate(() => exampleIn("Next, could you tell me what exactly the provider must do and what they need to deliver, such as processing feeds, providing alerts or reporting?")))
    .toBe("processing feeds, providing alerts or reporting");
  expect(errors).toEqual([]);
});

test("a message that copies an earlier question's wording corrects that question, and the current one is asked again", async ({ page }) => {
  await openApp(page);
  await say(page, CONSULTING);
  await until(page, "scope_in");
  await say(page, "Assess the current model");
  await idle(page);
  expect(await page.evaluate(() => S.lastAsked)).toBe("scope_out");
  // the case from a real run: the requester pastes the earlier question's example to fix the obligations
  await say(page, "what exactly must the provider do and deliver, for example a current-state process map and a rollout plan");
  const got = await page.evaluate(() => ({ scope: S.f.scope_in, out: S.f.scope_out, asked: S.lastAsked, msgs: S.msgs.slice(-3).map((m) => m.text || "").join("\n") }));
  expect(got.scope).toBe("A current-state process map and a rollout plan");
  expect(got.out).toBeFalsy();
  expect(got.asked).toBe("scope_out");
  expect(got.msgs).toMatch(/Changed: what the provider does/);
  expect(got.msgs).toMatch(/What is not part of the work/);   // a consulting project: "the work", not "the service"
});

test("'see above' is not an answer, and 'use your example' accepts a suggestion", async ({ page }) => {
  await openApp(page);
  await say(page, CONSULTING);
  await until(page, "background");
  await say(page, "see above");
  await expect(lastAssistant(page)).toContainText("Could you say a little more?");
  await say(page, "Buyers lack category expertise; if delayed we miss our delivery timelines");
  expect(await page.evaluate(() => S.f.background)).toMatch(/category expertise/);
  await until(page, "audience_fn");
  await say(page, "use your example");
  expect(await page.evaluate(() => [S.sugAccepted.audience_fn, givenText(S.f.users) !== ""])).toEqual([true, true]);
});
