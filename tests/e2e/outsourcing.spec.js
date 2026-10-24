// Outsourcing determination (EBA/GL/2019/02 as the group standard, EBA/GL/2026/09 as the future rule set).
// One full conversation through the UI, plus a rule table run against the page's own rules engine.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, answerUntilDone, lastAssistant, choices, start } = require("./helpers");

const KYC_ANSWERS = [
  [/cost in total/i, "About 600k"],
  [/business problem/i, "A backlog of overdue KYC reviews flagged by the regulator; if delayed we face supervisory action"],
  [/use today/i, "Temporary staff and spreadsheets"],
  [/exactly must the provider do/i, "Run periodic KYC reviews for 3,000 corporate clients and document each file"],
  [/When (do you need it|should it start)/i, "1 February 2027"],
  [/Where and how/i, "Remotely from the provider's centre in Frankfurt"],
  [/budget already approved/i, "Yes"],
  [/kind of data/i, "Client names, ownership structures and ID documents, stored in the EU"],
  [/bank does itself today/i, "We could realistically do it"],
  [/Which legal entity of the bank/i, "EU banking entity (Germany)"],
];

test("an ongoing KYC operations service is flagged as likely outsourcing, with the test steps in the record", async ({ page }) => {
  const errors = await openApp(page);
  await start(page, "KYC periodic reviews for our corporate clients for 2 years, around 600k.");
  await answerUntilDone(page, KYC_ANSWERS);

  const msgs = page.locator("#msgs");
  // nothing in the conversation names an entity (data storage and the provider's site don't count), so it is asked
  await expect(msgs).toContainText("Which legal entity of the bank will receive this service and sign the contract?");
  await expect(msgs).toContainText("Provisioning legal entity: EU banking entity (Germany)");
  await expect(msgs).toContainText("It's work the bank does or could realistically do itself");
  await expect(msgs).toContainText("Outsourcing: Outsourcing (likely) under EBA/GL/2019/02 (group standard)");

  const record = page.locator(".sd .record");
  await expect(record).toContainText("Provisioning legal entity");
  await expect(record).toContainText("Outsourcing (likely) (EBA/GL/2019/02, group standard)");
  // the new EBA guidelines (EBA/GL/2026/09) have no application date yet: no preview row; "Checked by you" is always true here
  await expect(record).not.toContainText(/Future rule set|Checked by you/);
  await expect(record).not.toContainText(/Legal entity\b/);
  // the test steps behind the result go to procurement in the request (the detailed document is switched off)
  const steps = await page.evaluate(() => outsourcing(S.f).steps.map(([s]) => s));
  for (const step of ["Excluded under paragraph 28", "Performed on a recurrent or ongoing basis (paragraph 26)",
    "Would or could realistically be performed by the bank itself (paragraph 26)", "Critical or important function (paragraphs 29 to 31)"]) expect(steps).toContain(step);
  await expect(page.locator(".sd [data-act=brd]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a branch outside the EU gets the same group standard", async ({ page }) => {
  await openApp(page);
  await start(page, "KYC periodic reviews for our Singapore branch clients for 2 years, around 600k.");
  // "stored in the EU" and "the provider's centre in Frankfurt" must not decide the entity
  await answerUntilDone(page, KYC_ANSWERS);
  await expect(page.locator("#msgs")).toContainText("Provisioning legal entity: Singapore branch");
  await expect(page.locator(".sd .record")).toContainText("Outsourcing (likely) (EBA/GL/2019/02, group standard)");
});

// [label, first message, facts] -> expected result, paragraph 28 reason (or null), future rule set result
const RULES = [
  ["ongoing KYC operations", "KYC onboarding and periodic review operations for corporate clients for 2 years", { category: "bpo", duration: "2 years" }, "Outsourcing (likely)", null, "Non-ICT third-party arrangement, in scope"],
  ["HR and payroll SaaS", "A new HR and payroll system as SaaS for 3 years", { category: "software", demand_type: "software", tech_service: true, duration: "3 years" }, "Outsourcing (likely)", null, "Out of scope: ICT service under DORA"],
  ["office cleaning", "Office cleaning for the Frankfurt tower for 3 years", { category: "facilities", duration: "3 years" }, "Not outsourcing", "28(g)", "Non-ICT third-party arrangement, in scope"],
  ["litigation counsel", "External counsel to represent us in a court case", { category: "legal", duration: "12 months" }, "Not outsourcing", "28(g)", "Non-ICT third-party arrangement, in scope"],
  ["statutory audit", "Statutory audit of the 2027 accounts", { category: "consulting", duration: "12 months" }, "Not outsourcing", "28(a)", "Out of scope"],
  ["market data", "Bloomberg terminals for the trading desk, 2 years", { category: "market-data", duration: "2 years" }, "Not outsourcing", "28(b)", "Out of scope"],
  ["card scheme", "Visa card scheme membership for our debit cards", { category: "consulting", duration: "3 years" }, "Not outsourcing", "28(c)", "Out of scope"],
  ["SWIFT messaging", "SWIFT messaging connectivity", { category: "telecom", duration: "3 years" }, "Not outsourcing", "28(e)", "Out of scope"],
  ["correspondent banking", "Correspondent banking services in US dollars", { category: "consulting", duration: "3 years" }, "Not outsourcing", "28(f)", "Non-ICT third-party arrangement, in scope"],
  ["one-off strategy review", "A strategy review of our operating model", { category: "consulting", duration: "3 months" }, "Not outsourcing (likely)", null, "Non-ICT third-party arrangement, in scope"],
  ["ongoing PMO support", "Ongoing PMO support for our change portfolio for 2 years", { category: "consulting", duration: "2 years" }, "To be determined", null, "Non-ICT third-party arrangement, in scope"],
  ["laptops", "15 laptops for new joiners", { category: "it-hardware", demand_type: "goods", quantity: 15 }, "Not outsourcing", "28(g)", "Out of scope (likely)"],
];

test("the outsourcing rule table follows EBA/GL/2019/02 paragraphs 26 and 28", async ({ page }) => {
  await openApp(page);
  const rows = await page.evaluate((cases) => cases.map(([label, text, facts]) => {
    S.msgs = [{ role: "user", text }];
    const f = { ...BLANK_FACTS, summary: text, item: text, demand_type: "services", ...facts };
    f.in_house = inHouseFromText(f);           // as deriveFacts does during the conversation
    const o = outsourcing(f);
    return { label, result: o.result, ex: o.ex, future: o.future.result };
  }), RULES);
  for (const [i, [label, , , result, para, future]] of RULES.entries()) {
    expect.soft(rows[i].result, label).toBe(result);
    if (para) expect.soft(rows[i].ex, label).toContain(`paragraph ${para}`); else expect.soft(rows[i].ex, label).toBeNull();
    expect.soft(rows[i].future, label).toBe(future);
  }
});

test("saying we have never done it ourselves does not turn KYC operations into 'not outsourcing'", async ({ page }) => {
  await openApp(page);
  await start(page, "KYC periodic reviews for our corporate clients for 2 years, around 600k. We have never done this ourselves.");
  await answerUntilDone(page, KYC_ANSWERS);
  await expect(page.locator("#msgs")).toContainText("It's work the bank does or could realistically do itself");
  await expect(page.locator(".sd .record")).toContainText("Outsourcing (likely) (EBA/GL/2019/02, group standard)");
});

test("answers to the in-house question follow paragraph 26", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "Yes, we do it today": true, "We could realistically do it": true, "No, a bank wouldn't do this itself": false, "Not sure": "unsure",
    "No, but a bank could realistically do it": true, "We don't do it today, but a bank could": true, "No": false, "we could not realistically do it": false,
    // past practice alone answers only half the question: left open for the outsourcing review
    "Never done it ourselves": "unsure", "No, we've never done it": "unsure", "Our teams don't do this": "unsure",
  };
  const got = await page.evaluate((answers) => Object.fromEntries(answers.map((a) => [a, readAnswer("in_house", a)])), Object.keys(CASES));
  expect(got).toEqual(CASES);
});

test("past practice in the description does not decide the in-house test; an explicit 'a bank would not' does", async ({ page }) => {
  await openApp(page);
  const CASES = [
    ["KYC periodic reviews for 2 years; we have never done this ourselves", "bpo", "Outsourcing (likely)"],
    ["Payroll processing for 3 years; we don't do this today", "bpo", "Outsourcing (likely)"],
    ["Invoice processing for 3 years; we have always bought this in", "bpo", "Outsourcing (likely)"],
    ["Ongoing PMO support for 2 years; we have never done this ourselves", "consulting", "To be determined"],
    ["Ongoing PMO support for 2 years; a bank would not do this itself", "consulting", "Not outsourcing (likely)"],
  ];
  const got = await page.evaluate((cases) => cases.map(([text, category]) => {
    S.msgs = [{ role: "user", text }];
    const f = { ...BLANK_FACTS, summary: text, item: text, category, demand_type: "services", duration: "2 years" };
    f.in_house = inHouseFromText(f);
    return outsourcing(f).result;
  }), CASES);
  expect(got).toEqual(CASES.map((c) => c[2]));
});

test("the provisioning legal entity is the one named, not where data is stored or the provider sits", async ({ page }) => {
  await openApp(page);
  const CASES = [
    [["KYC reviews for our Singapore branch clients", "Client names, stored in the EU"], "", "SG"],
    [["KYC reviews for our Singapore branch"], "Remotely from the provider's centre in Frankfurt", "SG"],
    [["Payroll for the UK branch", "data stored in the EU and the UK"], "", "UK"],
    [["Hosting stored in Singapore for our UK branch"], "", "UK"],
    [["A new HR system for Frankfurt and London"], "", "EU"],
    [["Cleaning for our London office"], "", "UK"],
    [["A new HR system"], "On our premises in London", "UK"],
    [["Market data for the US entity in New York"], "", "US"],
    [["A new tool for the team"], "", null],
    [["Consultants for our procurement model", "our team sits in London and Singapore"], "Mostly remote, sometimes on site in Frankfurt", "UK"],
  ];
  const got = await page.evaluate((cases) => cases.map(([msgs, location]) => {
    S.msgs = msgs.map((text) => ({ role: "user", text }));
    return entityFrom({ ...BLANK_FACTS, location });
  }), CASES);
  expect(got).toEqual(CASES.map((c) => c[2]));
});

// SaaS or software we run ourselves: one question decides it (EBA/GL/2019/02 paragraph 26), asked only when the request doesn't say
test("who hosts and runs the software decides the outsourcing result and the DORA type", async ({ page }) => {
  await openApp(page);
  const run = async (first, pick) => {
    await page.click("#newBtn");
    await start(page, first);
    for (let i = 0; i < 40 && (await page.evaluate(() => S.lastAsked)) !== "hosting" && !(await page.locator("[data-act=submit]").count()); i++) {
      const chips = await choices(page).allInnerTexts(), q = await lastAssistant(page).innerText();
      if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion");
      else if (/cost in total/i.test(q)) await say(page, "About 400k");
      else if (/business problem/i.test(q)) await say(page, "Payroll runs on spreadsheets; if delayed we miss the reporting deadline");
      else if (/use today/i.test(q)) await say(page, "Spreadsheets; no team to build a replacement");
      else if (/must it be able to do/i.test(q)) await say(page, "Payroll for Germany and an audit trail; it works if 99% of payslips are right");
      else if (/When (do you need it|should it start)/i.test(q)) await say(page, "1 September 2027");
      else if (/see or access/i.test(q)) await say(page, "Employee names and salaries, stored in the EU");
      else if (chips.length) await choose(page, chips[0]);
      else await say(page, "Nothing else");
    }
    const asked = await page.evaluate(() => S.lastAsked === "hosting");
    if (asked && pick) await choose(page, pick);
    return page.evaluate(() => { const o = outsourcing(S.f); return { hosting: S.f.hosting, result: o.result, reasons: o.reasons.join(" "), ict: ictType(S.f), inHouseAsked: (S.req || []).includes("in_house") && !("in_house" in S.derived) }; });   // derived by the rules = never asked
  };
  const saas = await run("A new HR system to replace our payroll tool.", "The provider hosts and runs it");
  expect(saas).toMatchObject({ hosting: "provider", result: "Outsourcing (likely)", ict: "Cloud services: SaaS", inHouseAsked: false });
  expect(saas.reasons).toContain("The provider hosts and runs software the bank would otherwise run itself (SaaS).");
  const own = await run("A new HR system to replace our payroll tool.", "We install and run it ourselves");
  expect(own).toMatchObject({ hosting: "own", result: "Not outsourcing (likely)", ict: "Software licensing (excluding SaaS)", inHouseAsked: false });
  expect(own.reasons).toContain("still an ICT service under DORA");
  // the words already say it: no question
  await page.click("#newBtn");
  await start(page, "A new HR and payroll system as SaaS for 3 years, about 400k");
  expect(await page.evaluate(() => [S.f.hosting, (S.req || []).includes("hosting") && !known(S.f.hosting)])).toEqual(["provider", false]);
  // two options, one hosted and one installed: asked
  expect(await page.evaluate(() => hostingOf("Murex and Calypso would run on our servers in Frankfurt, the SaaS option would host in the US"))).toBeNull();
});
