// Full conversations in offline rules mode, one per buying route, from the first message to submission.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, answerUntilDone, sideFacts, downloadJSON, idle } = require("./helpers");

// realistic answers, picked by the question the app asks
const ANSWERS = [
  [/cost in total/i, "About 400k"],
  [/How long will the work run/i, "6 months"],
  [/business problem/i, "Our payroll tool is end of life in 2027 and payroll runs on manual spreadsheets; if this is delayed we miss the statutory reporting deadline"],
  [/use today/i, "Today an old on-premise payroll tool and spreadsheets; we have no team that could build a replacement"],
  [/must it be able to do/i, "Payroll for Germany and the UK, employee self-service and an audit trail; it works if 99.5% of payslips are correct in the first 3 months"],
  [/exactly must the provider do/i, "Find a venue, run the invitations and guest list, organise catering and host the evening for 40 guests"],
  [/supplier deliver/i, "A current-state process map, a target operating model and a rollout plan"],
  [/skills or experience/i, "Java 17, Spring Boot and payments experience"],
  [/day rate/i, "Around 900 euros a day"],
  [/work on\?/i, "Building the new payments API with our team"],
  [/When (do you need it|should it start)/i, "1 February 2027"],
  [/Where should it be delivered/i, "Frankfurt office, Taunusanlage 12"],
  [/Where and how/i, "On our premises in Frankfurt"],
  [/budget already approved/i, "Yes"],
  [/kind of data/i, "Employee names, salaries and bank details, stored in the EU"],
  [/access any of our/i, "No access"],
  [/access to our systems/i, "Yes, read access to the payments test system"],
];

async function finishAndSubmit(page, routeName) {
  const route = page.locator(".card .rec-h h2").last();
  await expect(route).toHaveText(routeName);
  // a below-threshold new demand offers an improvement round first; submitting anyway must stay possible
  if (await page.getByRole("button", { name: "Submit anyway" }).count()) await choose(page, "Submit anyway");
  await page.locator("[data-act=submit]").last().click();
  await idle(page);
  await expect(page.locator("#msgs .m.a").last()).toContainText(/Submitted\. Request REQ-\d{6} goes to/);
  await expect(page.locator("#msgs .m.a").last()).toContainText(routeName);
}

test("catalogue order: laptops are ordered from the catalogue", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await expect(page.locator("#msgs")).toContainText("Laptops and desktops");
  await expect(page.locator("#msgs")).toContainText("is in our catalogue");
  await expect(page.locator("#stepbar")).toContainText("Timing and delivery");
  await answerUntilDone(page, ANSWERS);

  await expect(page.locator(".rec-h h2")).toHaveText("Catalogue order");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("in the catalogue");
  const facts = await sideFacts(page);
  // the place came with the first message, so it is not asked again
  expect(facts).toMatchObject({ Item: "Laptops", Quantity: "15", "Where and how": "Frankfurt" });
  await expect(page.locator("#msgs")).not.toContainText("Where should it be delivered");
  await expect(page.locator(".sd .record")).toContainText("Buying route");
  // the description never carries the amount, the date or the place
  const desc = await page.locator(".sd .desc").innerText();
  expect(desc).not.toMatch(/€|Frankfurt|February|2027/);
  await expect(page.locator(".sd")).toContainText(/Strong|Good/);

  const { name, data } = await downloadJSON(page, async () => { await page.click("[data-act=more]"); await page.click(".more [data-act=json]"); });
  expect(name).toMatch(/^intake-\d+\.json$/);
  expect(data.decision).toMatchObject({ route: "catalogue", chosen: "catalogue", override: false });
  expect(data.facts).toMatchObject({ category: "it-hardware", quantity: 15 });
  expect(data.source).toBe("rules");
  expect(data.conversation[0]).toEqual({ role: "user", text: "We need 15 laptops for new joiners in Frankfurt." });

  await finishAndSubmit(page, "Catalogue order");
  await expect(page.locator(".sd .acts")).toContainText(/Submitted as REQ-\d{6}/);
  expect(errors).toEqual([]);
});

test("contract call-off: more support from the framework supplier", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "More support from Lakeshore Advisory for our operations team.");
  await expect(page.locator("#msgs")).toContainText("Operations consulting framework with Lakeshore Advisory");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("Contract call-off");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("No new competition is needed");
  await expect(page.locator(".sd .record")).toContainText("Lakeshore Advisory");
  await finishAndSubmit(page, "Contract call-off");
  expect(errors).toEqual([]);
});

test("external workers: contractors go through the staffing contract", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "Two Java developers as contractors for 9 months.");
  await expect(page.locator("#msgs")).toContainText("IT contractors");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("Contract call-off");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("External workers MSP with Tailspin Talent");
  const facts = await sideFacts(page);
  expect(facts).toMatchObject({ Role: "Java developer", People: "2", Duration: "9 months" });
  await finishAndSubmit(page, "Contract call-off");
  expect(errors).toEqual([]);
});

test("external workers: a total budget given as the 'rate or budget' is not printed as a day rate", async ({ page }) => {
  await openApp(page);
  await say(page, "Two Java developers as contractors for 9 months.");
  await answerUntilDone(page, [[/day rate/i, "40k"], ...ANSWERS]);
  await expect(page.locator(".sd .record")).toContainText("€40,000");
  await expect(page.locator(".sd .record")).not.toContainText("Day rate");
});

// the conversation from a real test run: "next week" for the start and "bank data" for the data question
const CONTRACTOR_TEST_RUN = [[/day rate/i, "40k"], [/When (do you need it|should it start)/i, "next week"], [/fixed deadline/i, "It can move"], [/kind of data/i, "bank data"]];

test("external workers: 'bank data' is asked where it is stored, and 'next week' is kept as a date", async ({ page }) => {
  await openApp(page);
  await say(page, "Two Java developers as contractors for 9 months.");
  await answerUntilDone(page, [...CONTRACTOR_TEST_RUN, [/where will that data/i, "in the EU"], ...ANSWERS]);
  await expect(page.locator("#msgs")).toContainText("where will that data (bank data) be stored or processed");
  const record = page.locator(".sd .record");
  await expect(record).toContainText(/bank data, stored in the EU/i);
  await expect(record).toContainText("19 Oct 2026 (next week)");
  await expect(page.locator(".sd .qual")).not.toContainText("where the data is stored");
});

test("external workers: a data answer without a place is listed in the quality check", async ({ page }) => {
  await openApp(page);
  await say(page, "Two Java developers as contractors for 9 months.");
  await answerUntilDone(page, [...CONTRACTOR_TEST_RUN, [/where will that data/i, "Not sure"], ...ANSWERS]);
  await expect(page.locator(".sd .record")).toContainText(/bank data/i);
  await expect(page.locator(".sd .qual")).toContainText("Data involved: where the data is stored is not given.");
});

test("a data answer says where it is stored; a relative start is kept as the date it stood for", async ({ page }) => {
  await openApp(page);
  const WHERE = { "bank data": false, "client names and IDs": false, "employee names and salaries, stored in the EU": true, "client data in Germany": true,
    "client data on our own systems": true, "the supplier hosts it": true, "kept on premises": true,
    // what an AI wrote for "employee names, salaries and bank details" in a real run
    "employee names, salaries and bank details; storage location unknown": false, "client names, not sure where it is stored": false };
  const WHEN = { "next week": "19 Oct 2026 (next week)", "ASAP": "12 Oct 2026 (ASAP)", "by next month": "1 Nov 2026 (by next month)",
    "1 February 2027": "1 February 2027", "start of March, we're hiring now": "start of March, we're hiring now", "19 Oct 2026 (next week)": "19 Oct 2026 (next week)" };
  const got = await page.evaluate(([w, d]) => [Object.fromEntries(w.map((t) => [t, saysWhere(t)])), Object.fromEntries(d.map((t) => [t, datedWhen(t)]))], [Object.keys(WHERE), Object.keys(WHEN)]);
  expect(got).toEqual([WHERE, WHEN]);
});

test("obligations keep the requester's verb", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => shallify("Run periodic KYC reviews for 3,000 corporate clients; escalate red flags to Financial Crime Compliance within 2 days; a monthly quality report"));
  expect(got).toEqual([
    "The Service Provider shall run periodic KYC reviews for 3,000 corporate clients.",
    "The Service Provider shall escalate red flags to Financial Crime Compliance within 2 days.",
    "The Service Provider shall deliver a monthly quality report.",
  ]);
});

test("new demand under the threshold: business-led sourcing with three quotes", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "An agency for a client dinner for 40 people, around 30k.");
  await expect(page.locator("#msgs")).toContainText("Events and hospitality");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("New demand: business-led sourcing");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("at least three quotes");
  await expect(page.locator(".rec-h .meta")).toContainText("€30,000");
  await finishAndSubmit(page, "New demand: business-led sourcing");
  expect(errors).toEqual([]);
});

test("new demand over the threshold: procurement-led RFP with the full service description", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "A new HR system to replace our payroll tool.");
  await expect(page.locator("#msgs")).toContainText("HR and payroll software");
  await answerUntilDone(page, ANSWERS);

  // the check step lists what the rules worked out and was confirmed
  await expect(page.locator("#msgs")).toContainText("Here's what I've worked out from your answers");
  await expect(page.locator(".rec-h h2")).toHaveText("New demand: procurement-led sourcing");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("RFP");
  // executive format: headline, executive description, summary table; no sourcing request text and no document (switched off)
  await expect(page.locator(".sd")).toContainText("1. Service description headline");
  await expect(page.locator(".sd")).toContainText("2. Executive service description");
  await expect(page.locator(".sd .srq, .sd [data-act=brd]")).toHaveCount(0);
  await expect(page.locator(".sd .record")).toContainText("€400,000");
  await expect(page.locator(".sd .record")).toContainText("ICT service (DORA)");
  // the record: software counts users, no materiality unless it applies, no "Future rule set" or "Checked by you"
  await expect(page.locator(".sd .record")).not.toContainText(/Future rule set|Checked by you|Materiality|Quantity/);

  await finishAndSubmit(page, "New demand: procurement-led sourcing");
  expect(errors).toEqual([]);
});

// Catalogue matching: whole words, the request's own demand type, and a value the catalogue price can explain.
for (const [text, category] of [
  ["A SaaS tool to track travel expenses for 400k", "software"],         // "pens" inside "expenses"
  ["A transaction monitoring system for AML, budget 400k", "software"],  // "monitor" inside "monitoring"
  ["Sanctions screening service for 3 years, around 300k", "bpo"],       // "screen" inside "screening"
  ["A dashboard tool to monitor sanctions alerts, 400k", "software"],    // "monitor" as a verb
  ["Software to manage our laptop fleet, 20k", "software"],              // a tie between "software" and "laptop"
]) {
  test(`"${text}" is not offered from the catalogue`, async ({ page }) => {
    await openApp(page);
    await say(page, text);
    await expect(page.locator("#msgs")).not.toContainText("is in our catalogue");
    await expect(page.locator("#side .route")).not.toHaveText("Catalogue order");
    expect(await page.evaluate(() => S.f.category)).toBe(category);
  });
}

test("category ties go to the head noun of the request, and a goods noun after 'to' is a verb", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "Software to manage our laptop fleet": "software",
    "A dashboard tool to monitor sanctions alerts": "software",
    "A service to screen clients against sanctions lists": "bpo",
    "A transaction monitoring system for AML": "software",
    "Sanctions screening software for 200 users": "software",
    "Sanctions screening service for 3 years": "bpo",
    "Laptops for the software team": "it-hardware",
    "A consultant to assess our KYC process": "consulting",
    "We need a new chair for the meeting room": "office",
  };
  const got = await page.evaluate((texts) => Object.fromEntries(texts.map((t) => [t, (bestCategory(` ${t.toLowerCase()} `) || {}).id])), Object.keys(CASES));
  expect(got).toEqual(CASES);
});

test("a budget the catalogue price explains stays a catalogue order", async ({ page }) => {
  await openApp(page);
  await say(page, "50 laptops for the new team, budget 60k");
  await expect(page.locator("#msgs")).toContainText("Standard laptop 14\" is in our catalogue");
});

test("keywords match whole words with a plural; a trailing * keeps a stem", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "travel expenses ~ pens": false, "transaction monitoring ~ monitor": false, "sanctions screening ~ screen": false, "a template ~ temp": false,
    "two monitors ~ monitor": true, "15 laptops ~ laptop": true, "office chairs ~ chair": true, "two temps ~ temp": true,
    "a consultant ~ consult*": true, "telecommunications ~ telecom*": true, "a freelancer ~ freelance*": true, "the reconsultation ~ consult*": false,
  };
  const got = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => { const [t, k] = key.split(" ~ "); return [key, kwHit(` ${t} `, k)]; })), Object.keys(CASES));
  expect(got).toEqual(CASES);
});

test("the catalogue is offered only when the value fits the catalogue price", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "no value yet": [{ value: null }, true],
    "50 laptops for 60k": [{ value: 60000, quantity: "50" }, true],
    "100 laptops for 400k": [{ value: 400000, quantity: "100" }, false],
    "no quantity, 30k": [{ value: 30000 }, true],
    "no quantity, 400k (above the sourcing threshold)": [{ value: 400000 }, false],
  };
  const got = await page.evaluate((cases) => {
    const laptop = CATALOGUE.filter((i) => i.id === "CAT-1001");
    return Object.fromEntries(Object.entries(cases).map(([name, [f]]) => [name, catalogueFits(f, laptop)]));
  }, CASES);
  expect(got).toEqual(Object.fromEntries(Object.entries(CASES).map(([name, [, want]]) => [name, want])));
});

// "To improve" keeps what this route did not ask as optional points, chosen for the demand, and each can be added in the chat
test("the quality check is one list; an optional point joins it only when it improves the description", async ({ page }) => {
  await openApp(page);
  await say(page, "A new HR system to replace our payroll tool.");
  await answerUntilDone(page, ANSWERS);
  const qual = page.locator(".sd .qual");
  await expect(qual).not.toContainText(/To improve|Still open|Optional for this request/);
  // governance and change management matter for the contract, not for the description: left to the buyer
  await expect(qual).not.toContainText(/change management|Governance|Critical or important function relevance/i);
  const shown = await page.evaluate(() => qualityGaps().optional.filter((g) => DESC_FACTS.includes(g.key) || g.secs.includes("Definitions")));
  await expect(page.locator(".sd .qual li.opt")).toHaveCount(shown.length);
  if (await page.locator('.sd .qual [data-act="addopt"]').count()) {
    await expect(page.locator('.sd .qual [data-act="addopt"]').first()).toHaveText("Answer one more question");
    await page.locator('.sd .qual [data-act="addopt"]').first().click();
    await idle(page);
    await expect(page.locator("#msgs .m.a").last()).toContainText("Sure, let's add it.");
  }
});

test("a one-off event gets no governance or change management points", async ({ page }) => {
  await openApp(page);
  await say(page, "An agency for a client dinner for 40 people, around 30k.");
  const EVENT = [
    [/business problem/i, "We host our top 40 clients once a year; without an agency we cannot organise it in time"],
    [/use today/i, "Our assistants organised it in the past, but they have no capacity this year"],
    [/How long will the work run/i, "One evening, a one-off event"],
    [/kind of data/i, "Guest names and email addresses, stored in the EU"],
    [/Where and how/i, "At a venue in Frankfurt"],
  ];
  await answerUntilDone(page, [...EVENT, ...ANSWERS]);
  await expect(page.locator(".sd .qual")).not.toContainText(/governance|change management|escalation/i);
});

test("a description built without the AI reads as sentences", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    Object.assign(S.f, { category: "software", demand_type: "software", users: "Procurement colleagues",
      background: "providing a single entry to procurement, reducing cycle time",
      must_haves: "handle approval workflows, would you measure success by cycle time, chatbot intake",
      acceptance: "success will be judged by cycle time and user satisfaction" });
    const t = offlineExec(firstPerson("Buy a process orchestration platform for procurement"));
    return { head: t.headline, exec: t.exec, item: itemFrom("Buy a process orchestration platform for procurement") };
  });
  expect(got.item).toBe("Process orchestration platform");
  expect(got.head).toContain("with a process orchestration platform for procurement.");
  expect(got.exec).toMatch(/^The organisation needs a process orchestration platform for procurement\./);
  expect(got.exec).toContain("The goal is providing a single entry to procurement");
  expect(got.exec).toContain("Success means: cycle time and user satisfaction");
  expect(got.exec).not.toMatch(/with buy|Today, providing|measured by success|would you/i);
});

test("'trading desk', 'service desk' and 'help desk' are teams, not office furniture", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "A call recording service for the trading desk": null,
    "A new service desk tool for our IT team": "software",
    "A help desk for our staff": "it-services",
    "We need 10 standing desks for the new office": "office",
  };
  const got = await page.evaluate((texts) => Object.fromEntries(texts.map((t) => [t, (bestCategory(` ${t.toLowerCase()} `) || { id: null }).id])), Object.keys(CASES));
  expect(got).toEqual(CASES);
});

test("a service no keyword knows is new demand, not a call-off on the consulting framework", async ({ page }) => {
  await openApp(page);
  await say(page, "Translation of our annual report into five languages, around 25k.");
  await expect(page.locator("#side .route")).toHaveText("New demand: business-led sourcing");
  await expect(page.locator("#msgs")).not.toContainText("This sounds like management consulting");
  await expect(page.locator("#msgs")).not.toContainText("Lakeshore");
});
