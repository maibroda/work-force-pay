# Entitlements E4: a DRAFT questionnaire, for the founder to edit

**Status: a draft proposal for you to change. Nothing here is built, and no rule below is in force until you approve it.** Written 2026-11-03, because the questionnaire files from the original document (`scripts/configure.ts`, `examples/`) are not in the repository, and you asked me to draft a first list. Every question comes from the module catalogue (`src/lib/entitlements/catalogue.ts`); I have invented no price, and the "plan choice" rule at the end is my assumption, flagged as such. The worked examples were produced by running the real E1 rules (`resolveModules`, `checkPlan`), not written by hand.

## 1. The questions (13) and what each answer does

Each question is yes or no, apart from the first. "Brings in" means the module is added to the blueprint; the E1 rules then add anything that module needs, and say why.

| # | Ask the prospect | If yes, it brings in | Note |
|---|---|---|---|
| 1 | How many employees will be on payroll? (a number) | nothing | Recorded as the employee limit on the quote. It is **not a module**, and limits are not checked until E6. |
| 2 | Do you need us to run payroll: pay, statutory deductions, payslips, bank files? | **Payroll** | |
| 3 | Do you need people records beyond pay: leave, onboarding and exit, appraisals, training, grievances, letters? | **HR management** | |
| 4 | Should your staff see their own payslips and request leave themselves? | **Employee self-service** | Needs Payroll or HR; the rules add one if neither is wanted. Partly built: no SMS or WhatsApp payslips yet. |
| 5 | Do you place workers at client sites under contracts (security, cleaning, facilities)? | **Contracts and deployment** | |
| 6 | Do you track attendance, shifts, rosters and overtime? | **Time and attendance** | Partly built: no clocking yet. |
| 7 | Do you invoice your clients and track what they owe? | **Client billing** | Needs Contracts and deployment or the CRM; the rules add the first unless you chose the CRM. |
| 8 | Should your clients approve payroll and download payslips in a portal? | **Client portal** | Needs Payroll. |
| 9 | Do you manage sales leads, a pipeline, quotes and client cases? (and how many sales users?) | **CRM** | The number of sales users is recorded as the CRM user limit (E6), not a module. |
| 10 | Do you keep your books in the app: ledger, journals, tax codes, fixed assets, bank reconciliation? | **Accounting** | |
| 11 | Do you buy from suppliers: purchase orders, goods received, supplier bills? | **Payables and procurement** | Needs Accounting. |
| 12 | Do you issue stock, such as uniforms or equipment, to employees? | **Inventory** | |
| 13 | Do you want management dashboards: labour cost, client and contract margin? | **Analytics** | |

**Not asked, on purpose:** Production pay, Sales and service-charge pay, and Integrations are **planned, not built**. A question about them would sell something that does not exist.

## 2. Worked examples (from the real rules)

| Prospect | Modules after the rules | Reasons the rules give |
|---|---|---|
| **A.** Payroll for 120 staff, who should see their own payslips (Q2, Q4) | Core, Payroll, Employee self-service | none beyond the core |
| **B.** A guard company that deploys staff, runs payroll and invoices (Q2, Q5, Q7) | Core, Payroll, Contracts and deployment, Client billing | none beyond the core |
| **C.** A firm that only manages prospects and clients (Q9) | Core, CRM | none beyond the core |
| **D.** Payroll, clients approve it in a portal, books kept in the app (Q2, Q8, Q10) | Core, Payroll, Accounting, Client portal | none beyond the core |

For each, the fit of every plan (what must be added on, what the plan includes that was not asked for), straight from `checkPlan`:

| | Payroll Core | HR + Payroll | CRM | Workforce Suite | Custom |
|---|---|---|---|---|---|
| **A** | add Self-service; 0 unasked | 0 added; 1 unasked (HR) | add 2; 1 unasked | 0 added; 13 unasked | add 2; 0 unasked |
| **B** | add 2; 0 unasked | add 2; 2 unasked | add 3; 1 unasked | 0 added; 12 unasked | add 3; 0 unasked |
| **C** | add CRM; 1 unasked (Payroll) | add CRM; 3 unasked | **0 added; 0 unasked** | 0 added; 14 unasked | add CRM; 0 unasked |
| **D** | add 2; 0 unasked | add 2; 2 unasked | add 3; 1 unasked | 0 added; 12 unasked | add 3; 0 unasked |

## 3. A rule I am assuming (please confirm or change)

**Which plan to propose.** I would pick the plan that needs the **fewest add-ons plus unasked modules**, and on a tie the one with **fewer add-ons**, and I would show the runner-up. By that rule A is a tie between **Payroll Core plus Self-service** and **HR + Payroll** (resolved to HR + Payroll, fewer add-ons), B and D are **Payroll Core with add-ons**, and C is **the CRM plan exactly**. This is a sales rule, not a technical one, so it is yours to set. Alternatives: always show the two closest, or always start from the plan named by the bureau package.

## 4. Two things the examples turned up

1. **Workforce Suite includes the three planned modules** (Production pay, Sales and service-charge pay, Integrations). Selling it today promises things that do not exist. Should the Suite exclude planned modules until they are built (my recommendation), or include them marked "coming soon"?
2. **The rules' reason text is noisy about the core.** For a prospect who wants Payroll, the rules say "Payroll needs Core platform, so Core platform was added", although the core is always on. A salesperson reading that would be confused. I would change it so the core never appears as "added" (a small fix in E4a, with a test).

## 5. What I need from you

Edit anything in section 1 (questions, wording, what each brings in), confirm or change the rule in section 3, and answer the two items in section 4. **The price book (E4b) is still needed and is separate:** owner, currency, charge basis per module, any minimum fee or discount, and whether it changes by date. I will not write E4a code until you have approved this list.
