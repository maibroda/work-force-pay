# Entitlements, step E6, reframed: Personnel management (the HR cycle) and payroll as the focal point (plan)

**Status: a plan, for the founder's rules and "go". No payroll, statutory or HR rule is changed by this document.** Written 2026-11-04. The founder's direction (2026-11-04): **Personnel management, the HR cycle and payroll are the focal point.** This replaces my earlier E6 idea (limits and ports for everything): the ports that matter are exactly where the HR cycle and payroll meet. Payroll is a critical module under `CLAUDE.md`: any change needs your rules, tests first (golden datasets green), and an explain-back note, and where a payroll rule is unclear I stop and ask.

## CORRECTION (2026-11-04, later the same day): finding 1 below was wrong

I wrote that payroll cannot pay anyone who is not deployed to a client site, and that the plans "Payroll Core" and "HR + Payroll" cannot run payroll for an office-based firm. **I was wrong: I missed a rule in the pay run** (`payroll.ts`, `rates.ts`). **An employee with a pay rate (a monthly gross set on their record) and no work-register days is paid for every day they are employed, under "Head Office"**, and the gross is split into components by a salary structure: the pay rate's chosen structure, else the contract rate's, else the company's default. A pay rate also **takes precedence** over a contract-derived gross for an employee who has both. So payroll for office-based staff works today through pay rates. What is actually missing is smaller:
- **(a) Entering the gross.** It can only be set on the employee's record (Salary & overrides), by someone with the override permission, one employee at a time. It cannot be given in the bulk import or when adding an employee.
- **(b) A suitable structure.** The company's default is the "Standard Security Workforce Structure" (Basic 10%, Housing 14%, Transport 15% and so on), which gives an office employee a very small pensionable base. An office structure, and a way to say which structure applies to which category of staff, is needed.
- **(c) Unpaid leave** has no paid-or-unpaid distinction (leave counts as a paid day).
- **(d)** Paid days for a pay-rate employee are the **calendar days employed** in the period, so joiners and leavers are prorated by calendar days.

The note added to blueprints in #134 wrongly said payroll could not run without Contracts and deployment; it now says how payroll runs there. Everything below that depends on finding 1 is superseded by the questions in section 7.

## 1. What I found (checked in the repository, 2026-11-04)

1. **[WRONG: see the correction above.] Payroll cannot pay anyone who is not deployed to a client site.** The pay run pays an employee only for days in the work register (`payroll.ts`: an employee with no register records "was not paid"). Every register day carries a client, a contract and a site (all three are required columns), and there are only two ways to create one: recording attendance at a site, and approving leave for an employee who has a site assignment. So **payroll needs Contracts and deployment in practice**, although the catalogue says it needs only the core. **The plans "Payroll Core" (Core and Payroll) and "HR + Payroll" cannot run payroll for an office-based firm as the app is built.** Nothing is enforced today, so no client is harmed, but a quote could sell something that cannot run.
2. **The leave bridge exists, but only for deployed staff, and has no "unpaid".** Approving leave marks the register days as LEAVE; a day with no site assignment is skipped ("no assignment"). Payroll counts LEAVE as a **paid** day. There is no paid-or-unpaid distinction on a leave type. The catalogue's port "unpaid leave for payroll" has no counterpart in the app.
3. **The HR cycle itself is broad and built.** Requisitions, candidates, contracts, onboarding, leave and balances, appraisals, training, relations (discipline and grievances), breaches, exits, attrition, letters, policies, retention and data requests all exist as pages; final settlements are in the payroll area. What is missing is not the cycle but its **joint with payroll for companies without sites**.

## 2. Done now (no payroll change)

The configurator now tells a salesperson, in the blueprint's notes, that payroll cannot yet run for a company that does not place workers at client sites (`configure.ts`, with a test). It is removed when the work below is done. This is a statement of what the app does, not a rule.

## 3. What I recommend, in order

**P1. [Reframed: see the correction above. Payroll without deployment already works through pay rates; what is missing is (a) to (d) there.]** A "paid days" source for employees who are not on a site: the days to pay are entered on the pay run (the founder's original port design, "days entered on the pay run"), instead of coming from the work register. The existing deployed-workforce payroll is unchanged and stays the default; its golden tests must stay green. **I will not guess the rules**; the questions are in section 5.
**P2. Leave for everyone, paid and unpaid.** A paid-or-unpaid flag on a leave type, approved leave flowing to payroll for office staff as well as deployed staff (as paid days or as unpaid days that reduce pay), and the right balance behaviour. Also a payroll rule.
**P3. A complete HR-cycle blocker list.** My E5a lists cover pending leave and open onboarding and exit tasks; the cycle also has **final settlements awaiting approval** (money: a hard blocker), open disciplinary cases, appraisals in a cycle and open requisitions (soft). I will add them, tests first, once you confirm the list in section 5.
**P4. The rollout order for the module switch, with the focal modules last and protected.** Recommended order, REPORT first each time: Analytics, Inventory, Accounting and Payables, Client billing, the CRM, the client portal; **HR and Payroll last, and only after P1 and P2**, because they are your focal modules, every paying client uses them, and the grandfathered Custom plans already include them. I will not turn anything on: it is your decision.
**P5. Limits** (headcount and sales-user checks) once P1 is done: the employee limit then counts the people the HR cycle and payroll actually run.

## 4. What this protects

Existing clients and the demo company are deployed-workforce companies: they must see no change. Every P-step is behind your rules and keeps the golden datasets and the exact-money rules (whole kobo, half up once, in the shared utility; statutory rates as dated settings, never in code).

## 5. What I need from you (payroll and HR rules; I will not assume them)

1. **Which firms must the HR + Payroll plans serve?** Office-based salaried firms with no client sites (my assumption, from "Personnel management")? If so, P1 is required before those plans are sold.
2. **Paid days for a salaried employee not on a site:** the full period by default? Prorated for joiners and leavers, by **calendar days or by working days**? How are public holidays and weekends treated? Is it entered per employee on the pay run, or a default with exceptions?
3. **Unpaid leave:** which leave types are unpaid (for example unpaid or study leave)? Does unpaid leave reduce pay by the same proration as joiners and leavers? Any statutory treatment I must not guess (pension, PAYE, NHF on a part-paid month)? **If a rule is statutory, I stop and ask your adviser.**
4. **Final settlements and exits:** which pending items should hard-block removing HR: a final settlement awaiting approval (my recommendation: yes), an exit in progress, open disciplinary cases?
5. **The leave bridge for deployed staff:** unchanged unless you say otherwise.
6. **Confirm the rollout order** in P4, and that HR and Payroll stay OFF (not enforced) until P1 and P2 are done.

## 6. If you say "go"

I would start **P3** now (it needs only your list in question 4, no payroll rule) and write the P1 design for your rules in questions 1 to 3 before any payroll code. I would not start P1 or P2 until you have answered 1 to 3.

## 7. Questions arising from the correction and the founder's request on the gross salary (2026-11-04)

The founder asked that **when determining the gross salary the system allow the gross amount to be entered manually, and work out its components, for a person who does not follow the usual lead, contract, client route.** That is the pay rate above. To extend it I need these answers (each is a payroll rule, so I will not guess):
1. **Where to enter it:** on the employee's record only (as now), also **in the bulk import** (columns for the monthly gross and the salary structure), also when **adding an employee**? My recommendation: all three.
2. **Who may enter it, and does it need approval?** Today it needs the override permission, a typed "approved by" name and takes effect at once. My recommendation: HR may propose a gross, and a payroll manager approves it before it counts (a second person), as for other pay changes.
3. **The structure for office staff:** what should the components and percentages be (for example Basic, Housing, Transport and the rest), and which of them are pensionable and taxable? **Whoever advises you on pension and PAYE must confirm this; I will not invent percentages.** May there be several structures (for example by category of staff), with one chosen as the default for each category?
4. **What the entered amount is:** the **monthly gross** (before deductions, not including the employer's pension contribution)? Or may an **annual package** be entered and divided by twelve?
5. **Paid days:** confirm that a pay-rate employee is paid for the **calendar days employed** in the period (full month; joiners and leavers prorated by calendar days), as it works now, or should it be **working days**?
6. **Unpaid leave:** which leave types are unpaid, and how should an unpaid day reduce pay (by the same calendar-day proration)? Any statutory treatment (pension, PAYE, NHF on a part-paid month)?
7. **An employee who is on a contract and also has a pay rate:** the pay rate wins today. Confirm that is wanted (for example a supervisor paid differently from colleagues on the same contract).
