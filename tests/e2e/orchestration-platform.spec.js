// From a live AI test (October 2026): "I want to buy a process orchestration platform for procurement", a SaaS product with no bank domain.
// Suggestion edits, the hosting answer, where the data is stored, the go-live date and the description wording from that run.
const { test, expect } = require("@playwright/test");
const { openApp, say, lastAssistant, mock, start } = require("./helpers");

const FIRST = "I want to buy a process orchestration platform for procurement";

test("suggestion edits: numbers with commas, several drops, a cut figure and an add to the line it names", async ({ page }) => {
  await openApp(page);
  await start(page, FIRST);
  const got = await page.evaluate(() => {
    const aud = "Target audience: Procurement analysts, sourcing managers\nSupported functions: Procurement, Finance";
    const vp = "Unique selling points: one front door for all requests\nKey benefits: Reduces approval cycle from 3 weeks to 2 days; cuts manual data entry; reviews within 5 working days\nRegulatory / governance benefits: Generates audit trails; supports SOX and Basel III control frameworks; enforces approval limits";
    const kp = "Service levels: 99.5% uptime during business hours\nKPIs: average request processing time, user adoption rate";
    const r = {};
    r.add = editSuggestion(aud, "add all requesters across the bank, about 5,000 people, rest is fine");
    S.f.users = r.add.split("\n")[0].replace(/^Target audience:\s*/, "");
    r.users = usersFromAudience(S.f);
    r.drop = editSuggestion(vp, "Ariba stays, the platform sits on top of it as the front door. drop the SOX and Basel III part and the 2 days, rest is fine");
    r.kpi = editSuggestion(kp, "add approval cycle time under 5 days as a KPI, otherwise ok");
    r.zero = usersFromAudience({ ...S.f, users: "about 0 people" });
    return r;
  });
  expect(got.add.split("\n")[0]).toBe("Target audience: Procurement analysts, sourcing managers; all requesters across the bank; about 5,000 people");
  expect(got.users).toBe(5000);
  expect(got.zero).toBeNull();
  // the SOX point goes; "to 2 days" is cut from its point; the point that only shares the word "days" stays
  expect(got.drop).toBe("Unique selling points: one front door for all requests\nKey benefits: Reduces approval cycle from 3 weeks; cuts manual data entry; reviews within 5 working days\nRegulatory / governance benefits: Generates audit trails; enforces approval limits");
  expect(got.kpi).toBe("Service levels: 99.5% uptime during business hours\nKPIs: average request processing time, user adoption rate; approval cycle time under 5 days");
});

test("software the provider hosts is outsourcing without a bank domain; 'don't know' elsewhere in the request is not a hosting answer", async ({ page }) => {
  await openApp(page);
  await start(page, FIRST);
  const got = await page.evaluate(() => {
    // since the golden-set fix, hosting is read only from what describes the new solution (first request, item, must-haves,
    // scope, deliverables), so the statements go into those fields rather than into later chat answers
    const f = { ...S.f, scope_in: "Requesters don't know where to start: requests come in by email, Ariba and Excel",
      must_haves: "It would be hosted by the vendor, EU data centre" };
    const r = { domain: bankDomain(f), hosting: hostingFromText(f), unsure: hostingOf("not sure yet") };
    r.inHouse = inHouseFromText({ ...f, hosting: "provider" });
    r.own = inHouseFromText({ ...f, hosting: "own" });
    r.result = outsourcing({ ...f, hosting: "provider", in_house: true }).result;
    // a later answer to another question (here: the data question) does not answer the hosting question
    S.msgs.push({ role: "user", text: "yes, requester names and emails, supplier names and contract values. it would be hosted by the vendor, EU data centre" });
    r.fromLaterAnswer = hostingFromText(S.f);
    return r;
  });
  expect(got).toEqual({ domain: null, hosting: "provider", unsure: "unsure", inHouse: true, own: null, result: "Outsourcing (likely)", fromLaterAnswer: null });
});

test("where the data is: kept from the same answer when the AI leaves it out, and 'as I said, the vendor's EU data centre' adds the place", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await start(page, FIRST);
  await page.evaluate(() => { S.f.personal_data = true; refresh(); S.lastAsked = "data_details"; });
  await mock(request, { nextChat: { facts: { data_details: "requester names and emails, supplier names and contract values" } } });
  await say(page, "yes, requester names and emails, supplier names and contract values. it would be hosted by the vendor, EU data centre");
  expect(await page.evaluate(() => S.f.data_details)).toBe("requester names and emails, supplier names and contract values; hosted by the vendor, EU data centre");
  await expect(lastAssistant(page)).not.toContainText("where will that data");
  // the place, in the requester's words
  const got = await page.evaluate(() => ["the vendor's EU data centre", "client data in Germany", "client names; nothing else"].map(whereFrom));
  expect(got).toEqual(["the vendor's EU data centre", "in Germany", ""]);
});

test("the follow-up answer 'as I said, the vendor's EU data centre' keeps the data", async ({ page }) => {
  await openApp(page);
  await start(page, FIRST);
  for (let i = 0; i < 40 && (await page.evaluate(() => S.lastAsked)) !== "personal_data"; i++) await say(page, "skip");
  expect(await page.evaluate(() => S.lastAsked)).toBe("personal_data");
  await say(page, "yes, requester names and emails, supplier names and contract values");
  await expect(lastAssistant(page)).toContainText("where will that data");
  await say(page, "as I said, the vendor's EU data centre");
  expect(await page.evaluate(() => S.f.data_details)).toBe("Requester names and emails, supplier names and contract values, stored in the vendor's EU data centre");
});

test("a go-live quarter gets its year, benefits written as verbs read as a sentence, and only the description's abbreviations are listed", async ({ page }) => {
  await openApp(page);
  await start(page, FIRST);
  const got = await page.evaluate(() => {
    const r = { q2: datedWhen("end of Q2"), march: datedWhen("by 1 March"), kept: datedWhen("start of March, we're hiring now"), dated: datedWhen("end of Q2 2027") };
    r.scopeOut = FACTS.scope_out.q(S.f);
    S.msgs.push({ role: "user", text: "drop the SOX and Basel III part" });
    Object.assign(S.f, { users: "All requesters across the bank", benefits: "Reduces approval cycle from 3 weeks; cuts manual data entry; improves user satisfaction", must_haves: "one intake form, SSO" });
    const ex = offlineExec("a process orchestration platform for procurement");
    r.delivers = /It delivers reduces/.test(ex.headline + ex.exec);
    r.verbs = ex.headline.includes("It reduces approval cycle from 3 weeks, cuts manual data entry and improves user satisfaction.");
    const def = sectionQuality().find((x) => x.sec === "Definitions");
    r.abbr = def.issue;
    return r;
  });
  expect(got).toEqual({ q2: "end of Q2 2027", march: "by 1 March 2027", kept: "start of March, we're hiring now", dated: "end of Q2 2027",
    scopeOut: "What is not part of it? Clear exclusions avoid misunderstandings later.", delivers: false, verbs: true, abbr: "Abbreviations used: SSO" });
});
