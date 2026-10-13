# Test taxonomy skeleton (realistic test data for a European bank)

Fictional but realistic. It is used to prove the app works with ~400 Level 4 (L4) categories. Each L4 belongs to one
**rule theme**. The theme decides which questions the app asks and how the outsourcing check runs, so it must fit what the
L4 buys.

## Files each author writes (UTF-8 CSV, comma-separated, header row, quote any field that contains a comma)

`l4-<group>.csv`
```
code,name,l1,l2,l3,theme,desc,kw
```
- `code`: `L4-XXNN`, where XX is the L2 prefix you own (below) and NN runs 01–99. Codes listed under "keep" must exist with
  that meaning.
- `name`: how a procurement taxonomy names it, 2–7 words, e.g. "Recruitment process outsourcing".
- `l1`, `l2`, `l3`: the parent names exactly as given below. You may split an L2 into the L3 groups listed, or add an L3
  where noted.
- `theme`: one of the theme ids given for that L2/L3.
- `desc`: one sentence (12–30 words) saying what falls under it and, where useful, what does not ("not X: see Y").
- `kw`: 3–8 search terms separated by `;`, in the words a requester would type. Lowercase. Avoid generic words (service,
  services, management, support, solution, system, provider, platform) unless they are part of a fixed term ("service desk").

`suppliers-<group>.csv`
```
supplier,preferred_l4
```
- Fictional, plausible company names, never real companies. Use the existing fictional names where listed.
- `preferred_l4`: L4 codes separated by `;`. Aim for 0–3 preferred suppliers per L4, some suppliers covering several L4s,
  and a few L4s with none.

`contracts-<group>.csv`
```
id,supplier,title,l4,expires,remaining
```
- About 6–10 frameworks per author. `id` is `CTR-XXNN` using your prefix. `l4` lists codes separated by `;`.
- `expires` is YYYY-MM-DD, mostly 2027–2029, with one or two expiring in 2026-12 or 2027-01.
- `remaining` is a whole-euro amount.
- Keep the fixed contracts listed below exactly.

## Fixed items that existing tests rely on (keep exactly)

**Preferred suppliers for every L4 of their theme**, alongside specialists:
- it-hardware: Northwind IT
- software: Adatum Software
- it-services: Proseware Digital, Fourth Coffee Tech
- cloud: Contoso Cloud
- consulting: Lakeshore Advisory, Blue Yonder Partners
- legal: Wingtip Legal
- marketing: Coho Creative
- facilities: BrightClean
- contingent: Tailspin Talent
- market-data: Datum Feeds
- training: Litware Learning
- office: Contoso Office
- telecom: Fabrikam Mobile
- audit-tax: Trey Assurance
- hr-services: VanArsdel Search

**Contracts (id, supplier, title, l4, expires, remaining):**
- CTR-1401, Contoso Cloud, Cloud hosting framework, all cloud L4s, 2028-03-31, 2400000
- CTR-2101, Lakeshore Advisory, Operations consulting framework, L4-2101 and the other operating-model and process consulting
  L4s, 2027-06-30, 600000
- CTR-2501, BrightClean, "Facilities cleaning, EMEA", cleaning L4s, 2027-12-31, 900000
- CTR-2701, Tailspin Talent, External workers MSP, all contingent L4s, 2028-01-31, 5000000
- CTR-2201, Wingtip Legal, "Legal panel, commercial", all legal L4s except notary, 2027-09-30, 350000
- CTR-2401, Litware Learning, Learning services framework, all training L4s, 2026-11-30, 80000
- CTR-1301, Proseware Digital, Application development framework, L4-1301 and the development, maintenance and testing L4s,
  2027-10-31, 1200000

## Rule themes
- it-hardware (goods)
- software (software and SaaS)
- it-services (IT build, run and security services)
- cloud
- telecom
- market-data
- consulting
- legal
- audit-tax
- marketing (marketing, events, hospitality)
- training
- facilities
- office (office supplies and furniture, goods)
- contingent (external workers under our direction)
- hr-services (recruitment and HR services)
- bpo (the provider runs a business process for us)
- fin-infra (card schemes, clearing, payment schemes, SWIFT, correspondent banking, market infrastructure)
- utilities
- travel (travel and company cars)
- insurance (insurance cover the bank buys)

## L1 / L2 / L3 tree, owners, prefixes and target counts (total ≈ 400)

### Author A1, L1 "Technology"
**L2 "IT hardware"** (prefix 11, theme it-hardware), ~20 L4s.
- L3: End-user devices; Mobile devices; Printing devices; Data centre hardware; Network and security hardware; Trading floor hardware.
- Keep L4-1101, "Laptops and desktops" (End-user devices).

**L2 "Software"** (prefix 12, theme software), ~45 L4s.
- L3:
  - Business applications: CRM, HR and payroll, finance and ERP, procurement and source-to-pay, document and records,
    workflow and process orchestration, collaboration, customer communication.
  - Banking and trading applications: core banking, payments software, trading and order management, risk and treasury,
    regulatory reporting, AML and sanctions screening software, KYC and client onboarding software, lending,
    wealth/portfolio.
  - Data and analytics software: BI, data platforms, AI/ML.
  - Infrastructure and security software: OS, database, middleware, security, identity, monitoring, backup.
  - Developer and IT tooling: dev tools, testing tools, ITSM.
  - Software maintenance and support.
- Keep L4-1201 "Software licences, installed (other)": installed or on-premise licences not covered by a function-specific L4.
- Keep L4-1202 "Software as a service (other)": SaaS not covered by a function-specific L4.
- The function-specific L4s cover both delivery models (SaaS or installed).

### Author A2, L1 "Technology"
**L2 "IT services"** (prefix 13, theme it-services), ~35 L4s.
- L3: Application services (development, maintenance, testing, integration, ERP/package implementation, data migration,
  low-code builds); Infrastructure and operations services (service desk, managed workplace, managed infrastructure,
  network operations, application support/run); Cyber security services (pen testing, SOC/managed detection, identity
  services, security assessments); Data and AI services; IT hardware services (repair, disposal, installation).
- Keep:
  - L4-1301 "Application development and maintenance";
  - L4-1302 "IT managed services and service desk";
  - L4-1303 "Cyber security services". Make 1303 the general cyber one; add specific ones next to it.

**L2 "Cloud and hosting"** (prefix 14, theme cloud), ~10 L4s.
- L3: Public cloud (IaaS, PaaS, cloud marketplace); Hosting and data centre (colocation, managed hosting, backup and
  disaster recovery as a service, CDN).
- Keep L4-1401 "Cloud infrastructure (IaaS and PaaS)".

**L2 "Telecom"** (prefix 15, theme telecom), ~12 L4s.
- L3: Mobile; Fixed voice and contact centre telephony; Data networks (WAN, MPLS, internet, dark fibre, SD-WAN); Trading
  voice (turrets, voice recording, hoot-and-holler); Video and collaboration services.
- Keep L4-1501 "Mobile voice and data".

### Author B: L1 "Market data and research" and L1 "Professional services"
**L2 "Market data and research"** (prefix 16, theme market-data), ~25 L4s.
- L3: Real-time and delayed market data; Terminals and desktops; Reference and pricing data; Ratings and credit data;
  ESG and alternative data; Research and news; Index and benchmark licences; Screening lists (sanctions, PEP, adverse
  media data); Economic and statistical data.
- Keep L4-1601 "Real-time market data feeds".

**L2 "Consulting"** (prefix 21, theme consulting), ~28 L4s.
- L3: Strategy and operating model (keep L4-2101 "Management and strategy consulting"); Technology consulting (keep
  L4-2102 "Technology consulting"); Risk, regulatory and compliance consulting; Finance and treasury consulting; People and
  organisation consulting; Procurement and supply chain consulting; Deal advisory and M&A; Programme and change management
  (PMO, change); Data and analytics consulting; Sustainability and ESG advisory; Actuarial and model validation.

**L2 "Legal, audit and tax"**:
- prefix 22 for legal, theme legal, ~15 L4s.
  - L3: Legal services: corporate and M&A, banking and finance law, litigation and disputes, regulatory and investigations,
    employment law, real estate law, IP and technology law, data protection law, notary services, legal process
    outsourcing, debt recovery legal.
  - Keep L4-2201 "Legal services (general counsel support)".
- prefix 20 for audit-tax, theme audit-tax, ~10 L4s.
  - L3: Audit and assurance (statutory audit, ISAE 3402/SOC reports, other assurance); Tax (compliance, advisory,
    transfer pricing, VAT); Accounting advisory; Forensic accounting; Valuation services.
  - Also keep L4-2202 "Audit, tax and accounting services (other)", using prefix 22 for this one.

### Author C: L1 "Operations and financial services" and L1 "People"
**L2 "Business process services"** (prefix 28, theme bpo), ~35 L4s.
- L3:
  - Financial crime operations (keep L4-2802 "Financial crime and KYC operations"; add AML investigations, sanctions alert
    handling, transaction monitoring alert review, periodic reviews, KYC remediation outsourced operations).
  - Payments and banking operations (keep L4-2803 "Payments and banking operations"; add trade finance operations,
    corporate actions, reconciliations, cash and securities settlement operations, mortgage and loan processing, fund
    administration).
  - Finance and HR operations (accounts payable, payroll processing, expense processing, HR administration).
  - Customer operations (contact centre, collections, complaints handling).
  - Document and mail operations (document scanning, print and mail, statement printing, archiving and records storage).
- Keep L4-2801 "Business process services (other)".

**L2 "Financial market infrastructure"** (prefix 29, theme fin-infra), ~12 L4s.
- Card schemes (Visa/Mastercard scheme fees); Payment schemes and clearing (SEPA scheme, ACH, real-time payments);
  Clearing houses and central counterparties; Central securities depositories and sub-custody; SWIFT messaging;
  Correspondent banking; Stock exchange and trading venue fees; Trade repositories and regulatory reporting hubs.

**L2 "Insurance"** (prefix 33, theme insurance), ~9 L4s.
- D&O; Professional indemnity; Property; Cyber insurance; Crime and bankers' blanket bond; Group life and health
  (employee benefits insurance); Travel insurance; Motor fleet insurance; Insurance broker services.

**L2 "External workforce"** (prefix 27, theme contingent), ~8 L4s.
- Keep L4-2701 "Contingent workforce and contractors". Add temporary agency staff, interim managers, IT contractors,
  MSP/VMS services, statement-of-work freelancers, student and graduate temps.

**L2 "HR services"** (prefix 27 continued from 2710 upward, theme hr-services), ~15 L4s.
- Keep L4-2702 "Recruitment and HR services (other)". Add recruitment agencies, executive search, recruitment process
  outsourcing, background screening, relocation and mobility, outplacement, employee assistance programme, occupational
  health, benefits administration, employer branding, assessment centres, payroll advisory, compensation benchmarking surveys.

**L2 "Learning"** (prefix 24, theme training), ~14 L4s.
- Keep L4-2401 "Training and learning (other)". Add leadership development, compliance and regulatory e-learning, IT and
  technical training, language training, professional certifications, coaching, learning platforms content libraries,
  graduate programmes, conference attendance fees, sales training, mandatory risk training.

### Author D: L1 "Marketing" and L1 "Real estate, facilities and corporate"
**L2 "Marketing and events"** (prefix 23, theme marketing), ~22 L4s.
- Keep L4-2301 "Events and hospitality".
- Add advertising (print, outdoor, TV, radio), media buying, digital marketing, social media agency, creative agency,
  PR and communications agency, sponsorship, client entertainment and tickets, conferences and venues, promotional
  merchandise, client gifts, marketing research and surveys, website and content production, photography and video
  production, brand design, direct mail campaigns.

**L2 "Facilities"** (prefix 25, theme facilities), ~35 L4s.
- Keep L4-2501 "Integrated facility management".
- Add:
  - cleaning;
  - catering and vending;
  - security guarding;
  - reception and front-of-house;
  - building maintenance and repairs;
  - HVAC maintenance;
  - lift maintenance;
  - electrical and fire safety;
  - waste and recycling;
  - landscaping;
  - pest control;
  - office moves and relocations;
  - workplace fit-out and refurbishment;
  - furniture installation;
  - mailroom and courier;
  - postal services;
  - document shredding;
  - archive storage (physical);
  - occupational safety services;
  - cash-in-transit and ATM servicing (still facilities theme, note "security logistics");
  - access control and CCTV maintenance;
  - energy management services;
  - water coolers;
  - plants and decoration;
  - parking management.

**L2 "Office supplies and furniture"** (prefix 26, theme office), ~14 L4s.
- Keep L4-2601 "Office supplies (other)".
- Add stationery, printer paper and toner, office furniture, ergonomic equipment, kitchen and pantry supplies, workwear and
  uniforms, branded business cards and letterheads, first-aid supplies, desk accessories, signage.

**L2 "Utilities"** (prefix 31, theme utilities), ~6 L4s.
- Electricity; gas; water and wastewater; district heating and cooling; energy brokerage and certificates; EV charging energy.

**L2 "Travel and fleet"** (prefix 32, theme travel), ~14 L4s.
- Air travel; hotels; rail travel; travel management company; car rental; taxis and chauffeur services; company car
  leasing; fuel cards; car maintenance and servicing; visa and immigration services for travel; travel risk services;
  meetings and incentive travel; airport lounges and fast track; pool vehicles.
