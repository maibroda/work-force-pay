# CRM Phase 3 plan: the deals board, stage rules, forecast, and the cost-aware quote builder

**Status: Phase 3a is BUILT (#98). Phase 3b (the quote builder) is BUILT on branch `feature/crm-phase-3b`, stacked on #98, after the founder's answers (2026-10-29): employer pension is 10% of Basic, Housing and Transport; ITF and NSITF are 1% of gross each; a quote line may carry its own share. Those figures come from the effective-dated rules (no percentage is written into the code), and the estimator runs the real payroll engine. The other questions were answered by my assumptions, listed at the end of this file, for the founder to correct.** The founder's "continue with CRM Phase 3" (2026-10-29) was taken as the go for 3a, including its small additive migration.

## 3a: built

| Piece | What it does |
| --- | --- |
| Board | One column per stage with each deal as a card; exact column totals of monthly value and weighted value; drag a deal or use the Move menu |
| Moves | Every move needs a **next step**; writes a permanent stage-history row (with days spent in the earlier stage) and an audit entry (stage names and ids only) |
| Stage gates | Site survey: start date and a contact. Won: monthly value above zero, term, start date. Lost: a reason. The message names exactly what is missing; nothing is written when a move is refused |
| Closed deals | Won (probability 100%, date stamped) and Lost (0%, reason, detail, competitor) are final: no further move or edit |
| Probability | The owner may set it (0 to 100) for an open stage; otherwise the stage's starting value |
| Weighted value | Monthly value x probability / 100, **rounded half up to the kobo once per deal**; a total is the exact sum of those. Yearly value is monthly x 12 and is never stored |
| Forecast | Open deals grouped by expected close month, with undated deals last |
| Rotting | A card turns red when a deal has had no activity for 14 days (a stage may set its own) |
| Deal page | Where it stands, its figures, a change form, its stage history |

**Choices I made:** a closed deal cannot be reopened (a mistake is corrected by adding a new deal); any change to a deal counts as activity on it; "quote sent" on Proposal sent is **recognised but not checked** until 3b exists, so the pipeline is usable meanwhile.

## 3b: the quote builder (plan; needs your answers)

The pack's quote builder prices a bid against the **real cost** of the guards, so the margin is known before the proposal goes out. It would **only read** pay rules; it never changes payroll.

**How a line is priced** (my proposal; please confirm or correct, because this is pay and statutory logic):
1. A quote line is: site, post type (an employee category, with its salary structure), headcount, shift label (a label only, it changes nothing in the sums), and the **bill rate per head per month**.
2. The guard's **monthly gross** = bill rate x the contract's operative share (the 70:30 split, 70% by default).
3. **Cost per head per month** = that gross + the employer's pension + ITF + NSITF + the other employer add-on costs for the business line (guarding or outsourcing), each at the percentage in the **effective-dated rules in force on the quote date**, computed with the same functions and the same rounding payroll uses (a test checks the estimate against a real payroll calculation).
4. **Line margin** = bill - cost; margin % of the bill; quote totals are exact sums in kobo. The rule versions used are **saved on the line**, so a later rule change never alters a sent quote.
5. A tenant **minimum margin %** (new setting, editable, proposed 0 until set): a quote below it needs a manager's approval before it can be sent (not the person who made it).
6. Quotes are versioned (editing a sent quote makes a new version); accepting one copies its monthly total into the deal's value; a proposal PDF is produced from a template (no logo yet: there is no file storage).

**Migration (reversible):** `CrmQuote`, `CrmQuoteLine`, a minimum-margin setting, quote approval columns. **No change to any payroll table.**

### Questions for you (the plan waits on these)
1. **Is the cost formula in point 3 right?** In particular: are employer pension, ITF, NSITF and the other add-ons charged on the guard's gross (the 70%), or on the whole bill rate? And is the company's cost of a guard exactly that, with nothing else (uniforms, training and leave reliever are among the add-on percentages)?
2. **Does the 70:30 split apply to every quote line**, or can a line carry its own share (a contract rate can)?
3. **Shift patterns:** a 24/7 post needs more guards than a 12-hour post. Should the line's headcount be what the client pays for (as in your rate cards), with the shift only a label? That is what I have assumed.
4. **Minimum margin:** what percentage should I start with, and who approves below it (company administrator only)?
5. **Is the quote for a won deal** what feeds the handover in Phase 5 (rate card and site lines)? I have assumed yes.

## After 3b
Phase 4 (activities, tasks, timeline, click-to-call and click-to-WhatsApp, daily digest) and Phase 5 (handover into operations) each get their own plan and go.

## 3b: what was built, and the assumptions to confirm

**Built:** `CrmQuote` and `CrmQuoteLine` (reversible migration `20261106120000_sales_quotes`, with a database guard that makes the lines of any quote that is not a draft permanent); the estimator (`src/lib/sales/cost-estimator.ts`), which runs the payroll engine on a synthetic full month for one guard, so employer pension, ITF, NSITF and every other add-on are worked out exactly as payroll works them and a test checks it against a direct engine run; exact quote arithmetic in kobo with margin in basis points; the minimum-margin setting and manager approval (not the maker); versions; accept or reject (accepting copies the monthly total into the deal); the client's PDF (bill rates and totals only, never cost or margin); the **Proposal sent stage now needs a quote that has been sent or accepted**.

**Worked example (a test):** a guarding line at ₦120,000 a guard with the 70% share: gross ₦84,000; employer pension ₦3,276.00 (10% of the ₦32,760 pensionable); ITF and NSITF ₦840.00 each; insurance ₦2,328.30, recruitment and training ₦3,259.62, leave reliever ₦6,829.68 and uniforms and kit ₦7,761.00 (percentages of what is left of the company's 30% share, as payroll does); employer costs ₦25,134.60; cost ₦109,134.60; margin ₦10,865.40 (9.05%).

**Founder's answers to the remaining questions (2026-10-29), now built:** (3) pricing separates the **billed headcount** from the **personnel actually needed to cover the shifts**: revenue follows the first, cost the second; (4) the **minimum gross margin is 15%**, a quote below it needs approval before it can be sent to the client, and the **threshold and the designated approver are formally defined** (a setting the company administrator changes, and a named list of approvers, audited); (5) an **accepted quote triggers the handover to Operations**, after approval and acceptance, capturing scope, client requirements, site locations, headcount, shift patterns, pricing, start date, equipment and service-level obligations: planned in `05-phase-5-plan.md`.

**Assumptions I made for the questions you did not answer (please confirm or correct), now reduced to:**
1. **The other employer costs** (insurance, uniforms and kit, recruitment and training, leave reliever, the outsourcing leave allowance) are included **because payroll charges them**; you named only pension, ITF and NSITF. They come from the same rule, so they can be set to zero there if they should not count in a quote.
2. The **other employer costs** are charged as payroll charges them (see 1).
3. **How many people a shift pattern needs is entered, not worked out**: I did not invent a roster formula (rest days, leave and working-time rules are yours to define). If you want the app to suggest the personnel for a pattern, give me the rule.
5. The default share paid to the guard is **70%** (the contract default); a line may carry its own.
