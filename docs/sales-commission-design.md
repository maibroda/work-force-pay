# Sales commission tracking — end-to-end process design

**Status: design for approval. Nothing here has been built.**

This designs commission tracking for Workforce from nothing, fitted to what the system already has (payroll inputs,
contracts, invoices, receipts, the ledger, exit settlements) and to what is planned (the CRM and the receivables
rebuild in `docs/finance-architecture.md`). It states the policy choices that change the design, recommends one for
each, and lists the decisions that are yours.

---

## 1. Principles

1. **Commission is a cost of winning and keeping revenue, so it follows the money, not the promise.** Pay on what the
   company has actually collected, net of what it later gives back.
2. **The terms are frozen when the deal is won.** A plan can change next year; it must not change what a rep was told
   when they signed a client.
3. **Every naira of commission traces to a document.** Each amount points at the invoice, receipt, credit note or
   adjustment that caused it, so a rep, a manager and an auditor can all follow it to the source.
4. **Nobody approves their own commission, and nobody edits history.** Corrections are new entries, never edits.
5. **The commission ledger reconciles to the general ledger** the same way receivables and payables do.
6. **Rules are configuration, not code.** Rates, triggers, tiers, caps, windows and clawbacks live in effective-dated
   plans.

## 2. The policy choices that shape everything

| Choice | Options | Recommended for a guarding / outsourcing business | Why |
| --- | --- | --- | --- |
| **When it is earned** | On signing · on invoice · **on cash collected** · split (some on invoice, rest on collection) | **On cash collected** | Guarding is paid in arrears and the receivable risk is real; paying on invoice means paying commission on money you may never see |
| **What it is calculated on** | Contract value · revenue excl. VAT · **management / indirect charge** · **contribution margin** | **Management charge (the 10% of the 90/10 split) or contribution margin** | About 90% of a guarding invoice is labour passed through at cost. A percentage of total revenue rewards signing low-margin work and can exceed the margin the deal earns |
| **Margin gate** | None · warn · block below a floor | **Needs approval below a configured margin** | Stops a rep winning revenue that destroys profit; the CRM already estimates margin per opportunity |
| **How long it pays** | One-off · first N months · whole contract | **First 12 months of a new contract at the new-business rate; renewals at a lower rate** | Rewards winning and retaining without paying forever |
| **Rate shape** | Flat · tiered by attainment · accelerators · caps | **Flat per plan, with optional tiers and a cap** | Simple to explain and audit; tiers only where quotas are real |
| **Who can earn** | Employees only · plus external agents and partners | **Both, by different payout routes** | Employees are paid through payroll and taxed as pay; agents are paid as suppliers with withholding tax |
| **Splits** | Single owner · shared · overlays | **Primary owner plus optional splits and a manager override, totalling a set maximum** | Real deals involve more than one person |
| **Accounting for it** | Expense as incurred · capitalise as a cost of obtaining a contract and amortise | **Policy setting; default expense** | IFRS 15 requires capitalising incremental costs of obtaining a contract when the benefit runs beyond a year, unless the expedient for periods up to a year is used; this is for your accountants |

## 3. The process, end to end

| # | Stage | Who | What the system does | Control | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | **Plan** | Sales director, Finance, HR | Defines effective-dated plans: eligibility, trigger, base, rate or tiers, cap, margin floor, duration, holdback, clawback window, leaver rule. Assigns each rep to a plan from a date | Plan changes need approval and never touch signed deals; rep accepts the plan in writing (recorded) | An approved plan version and an assignment |
| 2 | **Credit** | Rep, sales manager | The owner is on the lead and opportunity. Splits and overlays are set before the deal closes. They must total the plan's maximum | After Closed Won the credit is locked; changes need a reason and approval and are audited | Participants with percentages |
| 3 | **Qualify** | Sales manager, Finance | On Closed Won the system checks: contract signed, expected margin at or above the floor, customer credit acceptable. A failure routes to approval, not silently through | Margin and credit exceptions need Finance approval | An approved **commission agreement** linked to the opportunity, contract, plan version and participants, with the plan terms copied in |
| 4 | **Event** | System | Every billing event creates an immutable commission entry: invoice posted (pending), **receipt allocated (earned in proportion to cash collected)**, credit note or reversal (negative), manual adjustment | Entries are only ever added, each with its source document; VAT is excluded from the base | A running commission ledger per participant |
| 5 | **Calculate** | System, run monthly in the close cycle | Totals the period's earned entries, applies tiers, cap and holdback, nets clawbacks, produces a **statement per person**: opening, earned (by contract and invoice), clawbacks, adjustments, holdback, payable, closing | The run is reproducible: the same inputs give the same statement; a closed period is never recalculated | Draft statements |
| 6 | **Review** | Rep, sales manager | The rep sees the statement and every line's source, and may dispute within a set window | A dispute needs evidence and is resolved by someone other than the rep | Reviewed statements, disputes resolved |
| 7 | **Approve** | Sales manager → Finance → CFO above a threshold | Multi-level, amount-based approval | Segregation of duties: not the person paid, not their own override | Approved statements |
| 8 | **Account** | System | Posts the accrual: debit commission expense (or contract-cost asset), credit commission payable, with client, contract and region dimensions | Posting only into an open period; one posting per approved statement | Journal; payable subledger |
| 9 | **Pay** | Payroll or Accounts Payable | **Employees:** becomes an approved payroll *other earning* in the next run, so PAYE, pension where applicable and the payslip all work as for any pay. **Agents:** becomes a supplier bill with withholding tax, paid through payables | Payment only for approved statements; payroll posting clears the payable instead of expensing it again | Paid commission; payable reduced |
| 10 | **Claw back** | System, Finance | Credit notes, invoice reversals, cancelled contracts inside the window and written-off receivables create negative entries. A negative balance carries forward and is recovered from future commission; recovery from pay needs written consent | Clawback rules come from the frozen agreement; recovery from wages is checked against the law | Negative entries, carried balance |
| 11 | **Leave** | HR | On exit, unpaid commission is handled by the plan's leaver rule (forfeit, pay what is collected, or pro-rate). The exit settlement picks up payable commission and any clawback balance | Settlement approval as today | Settlement lines |
| 12 | **Report and reconcile** | Finance, sales leadership | Attainment, cost of sales, commission as a share of revenue and of margin, accrual reconciliation, exceptions | Commission payable subledger must equal the ledger control account before period close | Reports; period-close checklist item |

## 4. Calculation rules

- **Base** is revenue excluding VAT, or the management charge, or contribution margin, as the plan says. VAT is never
  part of it. Withholding tax the client deducts counts as collected once the credit is documented (the existing
  deduction record already requires a reason and a supporting document).
- **Earned on collection:** `earned = base × rate × (collected ÷ invoice total)`, accumulating as payments arrive.
  A payment is allocated to the invoice first, then the proportion applies to the commission.
- **Credit notes** reduce the base by their net amount and create a negative entry for what was already earned on it.
- **Tiers** apply to cumulative attainment in the plan year; accelerators apply from the point a threshold is crossed,
  never retrospectively unless the plan says so.
- **Cap** is per person per period or per deal, as set. **Holdback** retains a percentage until a later date.
- **Rounding** to the kobo at entry level, so a statement is always the sum of its lines.

**Worked example.** Charge-out ₦1,000,000 a month. Default split: direct ₦900,000, management ₦100,000, VAT on the
management charge ₦7,500, invoice total ₦1,007,500. Plan: 10% of the management charge, collected, for the first 12
months.

| Event | Commission entry |
| --- | --- |
| Invoice posted | ₦10,000 *pending* (nothing earned yet) |
| Client pays ₦906,750 (90% of ₦1,007,500) | ₦10,000 × 90% = **₦9,000 earned** |
| Client pays the remaining ₦100,750 | the last **₦1,000 earned** |
| Credit note ₦50,000 for a service reduction (all direct charge) | no change, because it was not in the management base |
| Credit note ₦10,000 against the management charge | ₦10,000 × 10% = **−₦1,000** |
| Invoice written off after 120 days with ₦40,000 uncollected | the uncollected share of the pending commission is cancelled; nothing already earned is clawed back unless the plan says so |

Under a margin plan (say 3% of contribution margin) the same events apply to the margin figure, taken from the
ledger and contract costing.

## 5. Accounting and tax

- **Accrual:** debit *Sales commission expense* (an operating-expense account in the 6000 range, with client,
  contract and region dimensions) and credit *Commission payable* when a statement is approved. If the company adopts
  capitalisation, the debit goes to a *contract cost asset* and an amortisation schedule runs over the contract term.
- **Payment to an employee:** the payroll posting for the commission earning debits *Commission payable* (not an
  expense again) and credits net pay, PAYE and pension payable as for any earning. The payroll GL mapping gets a
  head for it.
- **Payment to an agent:** a supplier bill with the withholding tax and VAT rules for that supplier, configured in the
  tax engine, not coded.
- **Tax treatment** of employee commission follows the PAYE rules already configured (it is taxable pay), and whether
  it counts as pensionable is a setting on the earning head. Withholding rates for agents and any VAT on their invoices
  are configuration. All of this needs your tax adviser's confirmation.
- **Reconciliation:** the sum of approved but unpaid statements equals the commission payable control account. The
  Phase 0 integrity check gains this pair.

## 6. Controls

- No self-approval. A manager's override on their own team's deals is approved one level up.
- Plan terms are snapshotted into the agreement at Closed Won; changing the plan later does not change it.
- Credit changes after Closed Won, manual adjustments and plan assignments are all approved and audited, with reasons.
- A statement can't be approved or paid with an unresolved dispute.
- **Exception reports** (reviewed monthly): commission earned on an unpaid invoice; splits that don't total the
  maximum; a plan changed after signing; a large manual adjustment; a rep who is also the approver; commission paid
  twice for the same source; payments to a participant with no active plan.
- Period close is blocked while statements for the period are unapproved or the payable doesn't reconcile.

## 7. Data model (all new tables; no existing table changes beyond a payroll-input link)

- `CommissionPlan` and `CommissionPlanVersion` (effective-dated: trigger, base, rate, tiers, cap, margin floor, duration,
  holdback, clawback window, leaver rule), `CommissionTier`, `CommissionPlanAssignment` (person or agent, plan, from /
  to), `SalesTarget` (quota by person and period).
- `CommissionAgreement` (opportunity or contract, the plan version snapshot, status, approval) and
  `CommissionParticipant` (person or agent, role PRIMARY / SPLIT / OVERLAY / MANAGER, percentage).
- `CommissionEntry`: the append-only ledger. Type (`INVOICE_PENDING`, `COLLECTED`, `CREDIT_NOTE`, `REVERSAL`,
  `ADJUSTMENT`, `CLAWBACK`), participant, agreement, base amount, rate applied, amount, **source document type and id**,
  period.
- `CommissionRun`, `CommissionStatement`, `CommissionStatementLine`, `CommissionDispute`, `CommissionPayout` (links to a
  payroll *other earning* or a supplier bill, and to the journal).
- Existing: `OtherEarning` gains a `sourceType` / `sourceId` so a commission earning is recognisable and can't be
  edited or double-entered by hand.

## 8. How it plugs into what exists

| Existing piece | Role |
| --- | --- |
| Contract, client, invoice, receipt, deduction | Source documents for entries; the 90/10 split and VAT give the management-charge base |
| Credit and debit notes, receipt allocation (Phase 3) | Needed first: collection-based commission depends on knowing which receipt settled which invoice |
| CRM opportunity and Closed Won (phase 8) | Creates the commission agreement automatically. Before the CRM exists, a sales owner and splits are set on the contract |
| Payroll `OtherEarning`, GL payroll mapping | Pays employees' commission, with approval, PAYE and the payslip |
| Payables, withholding tax | Pays agents |
| Exit settlements | Picks up payable commission and clawback balances |
| Approval engine (Phase 7) | Multi-level, amount-based, segregated approval at every approval point above |
| Period close and snapshots (Phase 4) | Statements approved and payable reconciled before close; the payable position is part of the snapshot |
| Cost allocation and profitability | Commission is a selling cost; margin by contract and by rep can be shown before and after it |

## 9. Reports

Rep statement (with drill-down to each invoice and receipt); plan attainment against quota; commission paid and accrued
by rep, team, client, contract and region; commission as a percentage of revenue and of margin; pending versus earned
(the commission pipeline); clawbacks; payable reconciliation; exception report; commission cost per new naira of
revenue by rep.

## 10. Edge cases the design has to answer

| Situation | Rule |
| --- | --- |
| Client pays late | Earned when collected; if the plan has a payment window, collections after it can pay at a reduced rate |
| Contract renewed | A new agreement at the renewal rate, linked to the original; the renewal owner may differ |
| Rep leaves mid-contract | The leaver rule decides: unpaid pending is forfeited, paid as collected, or pro-rated; already-earned stays earned |
| Territory or account moves to a new owner | Prospective only, from an approved date; earned entries never move |
| Rate or plan changes | Applies to agreements signed after the effective date only |
| Duplicate or disputed credit | Both reps' claims go to a manager; the resolution is an audited adjustment |
| Invoice reversed and replaced | The reversal creates a negative entry and the replacement a new pending one, so the rep isn't paid twice or lost |
| Partial payment across several invoices | Each allocation produces its own entry, so the statement ties to the receipt allocation |
| Foreign-currency invoice | Entries use the base-currency amount at the rate on the invoice, with collections measured against the same base |
| Negative balance after clawbacks | Carried forward and netted against future commission. Taking it from pay needs written consent and is checked against the limits on wage deductions |

## 11. Where it fits in the build order

The first version needs three things that come first: **receipt allocation and credit notes** (Phase 3) to know what
was collected against what, the **period-close snapshot** (Phase 4) so statements tie to a closed month, and the
**approval engine** (Phase 7) for segregated approval.

Recommended order: **Commission v1 straight after Phase 3.** The owner and splits live on the contract; the trigger
is collection; the monthly run produces statements; payout goes through payroll for employees. Then **Commission v2
with the CRM:** the agreement is created automatically at Closed Won, the margin gate reads the opportunity's
estimate, and quotas and forecasts connect to the sales targets.

## 12. Decisions for you

1. **Trigger.** On cash collected (recommended), on invoice, or split?
2. **Base.** Management charge, contribution margin, or revenue excluding VAT? Margin needs reliable contract costing
   (the payroll allocation gives it today).
3. **Who earns.** Employees only, or agents and partners too?
4. **Duration and renewal rates.** First N months at what rate; renewals at what rate?
5. **Clawback and leaver policy.** The window, and whether unpaid commission survives someone leaving.
6. **Accounting.** Expense as incurred, or capitalise under IFRS 15? (Your accountants.)
7. **Tax.** Pensionable or not; withholding treatment for agents. (Your tax adviser.)
8. **Dispute window and approval thresholds.**

Until these are answered I would not write plan logic; the structure above holds whichever way each goes.
