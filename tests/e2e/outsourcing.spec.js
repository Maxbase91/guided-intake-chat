// Outsourcing determination (EBA/GL/2019/02 as the group standard, EBA/GL/2026/09 as the future rule set).
// One full conversation through the UI, plus a rule table run against the page's own rules engine.
const { test, expect } = require("@playwright/test");
const { openApp, say, answerUntilDone } = require("./helpers");

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
];

test("an ongoing KYC operations service is flagged as likely outsourcing, with the test steps in the document", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "KYC periodic reviews for our corporate clients for 2 years, around 600k.");
  await answerUntilDone(page, KYC_ANSWERS);

  const msgs = page.locator("#msgs");
  await expect(msgs).toContainText("Provisioning legal entity: EU banking entity (Germany)");
  await expect(msgs).toContainText("It's work the bank does or could realistically do itself");
  await expect(msgs).toContainText("Outsourcing: Outsourcing (likely) under EBA/GL/2019/02 (group standard)");

  const record = page.locator(".sd .record");
  await expect(record).toContainText("Provisioning legal entity");
  await expect(record).toContainText("Outsourcing (likely) (EBA/GL/2019/02, group standard)");
  await expect(record).toContainText("Future rule set");
  await expect(record).toContainText("EBA/GL/2026/09, not yet applicable");
  await expect(record).not.toContainText(/Legal entity\b/);

  await page.click("[data-act=brd]");
  const doc = page.locator("#paper");
  await expect(doc).toContainText("Outsourcing determination");
  for (const step of ["Excluded under paragraph 28", "Performed on a recurrent or ongoing basis (paragraph 26)",
    "Would or could realistically be performed by the bank itself (paragraph 26)", "Critical or important function (paragraphs 29 to 31)"]) await expect(doc).toContainText(step);
  await expect(doc).toContainText("Checked by the requester");
  await expect(doc).toContainText("Yes, confirmed");
  await expect(doc).toContainText("Future rule set (versioned separately)");
  await expect(doc).toContainText("Finalised 18 September 2026; not yet applicable");
  await expect(doc).toContainText("it does not change the result above until it applies");
  await expect(doc).not.toContainText(/PRA SS2\/21|MAS Notice 658|APRA CPS 230|OSFI B-10/);
  expect(errors).toEqual([]);
});

test("a branch outside the EU gets the same group standard", async ({ page }) => {
  await openApp(page);
  await say(page, "KYC periodic reviews for our Singapore branch clients for 2 years, around 600k.");
  // no "EU" in the answers: the entity is picked from all text (see known-issues.spec.js)
  await answerUntilDone(page, KYC_ANSWERS.map(([re, a]) => [re, a.replace("Frankfurt", "Singapore").replace("stored in the EU", "stored in Singapore")]));
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
