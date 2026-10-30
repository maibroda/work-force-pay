# CRM Phase 5 plan: handover of an accepted quote to Operations

**Status: built on branch `feature/crm-phase-5` after the founder's "go" (2026-10-29), with the three answers below. Details, assumptions and tests are in `docs/RELEASE_NOTES.md`.** It creates operational records (client, contract, rates, sites) and so is a critical module (`CLAUDE.md` rule 11): its report and diff go to the independent reviewer.

**Choices made while building (to confirm):** (1) a site's **approved strength** is the people needed to cover the shifts (not the guards billed); (2) the contract's **total value is left blank**, the rates carry the prices; (3) one employee category carries one rate per contract, so a handover whose posts share a category but differ in pay structure, bill rate or share is refused until they are given different categories; (4) a handover is **one per deal**, so a quote that has a handover can no longer be revised; (5) the quote's **maker, the deal's owner and whoever sent the handover can never accept or return it**.

## What the founder asked for
1. **An accepted quote starts the handover to Operations.**
2. The handover **captures**: the agreed scope, the client's requirements, the site locations, the headcount, the shift patterns, the pricing, the start date, the equipment requirements, and any special service-level obligations.
3. **The quote goes through approval and acceptance first**: the handover is not started until the quote has been approved (when it was below the minimum margin), sent and accepted.

## How it would work
| Step | What happens | Who |
| --- | --- | --- |
| 1 | The quote is priced. Below the minimum margin (15% to start), a **designated approver other than its maker** approves it with a reason | already built (Phase 3b) |
| 2 | The quote is sent, and the client accepts it. Accepting a quote copies its monthly total into the deal | already built |
| 3 | **Accepting the quote creates a handover in DRAFT** and tells Operations a handover is being prepared. Nothing exists in Operations yet | new |
| 4 | The salesperson completes the handover (below) from what the quote already holds, and **submits** it | salesperson (maker) |
| 5 | **The handshake.** Operations reviews the handover and either **accepts it** (a signed acknowledgement: who, when, and any note) or **returns it to Sales with questions**. A returned handover goes back to the salesperson, who answers or corrects it and submits again; Operations accepts only the version it has read. Both sides have signed before anything is created | an Operations user who is **not** the maker (acceptor); the salesperson (maker) |
| 6 | **Only on approval** are the real client, contract, rate card and sites created, through their existing services (each audited); until then nothing is active and nothing in payroll, billing or operations has changed | the system |

A quote that is not accepted, or an accepted quote whose approval was needed and was not given, **cannot start a handover** (tested).

## What the handover holds
- **From the quote, pre-filled and read-only to the handover (so they cannot drift from what the client accepted):** the sites and posts, the **billed headcount and the personnel needed to cover the shifts** for each, the shift pattern of each, the **bill rate and monthly total** (not the company's cost or margin: those stay internal), the quote number and version, the validity.
- **Entered in the handover:** the agreed **scope of service**; the client's **requirements**; the **site locations** in full (address, state, local government, a site contact); the **start date** and **contract term**; the **equipment requirements** per site (uniforms and kit, radios, torches, vehicles, patrol and access-control equipment, with quantities); and the **special service-level obligations** (for example response times, reporting, replacement of an absent guard within a set time, penalties). It also records who prepared it and who approved it.
- All of it is kept with the handover as it was approved, so a later change to the deal or the quote never rewrites it.

## What would be created on approval (through the existing services)
A **client** (or the existing one is linked), a **contract** in DRAFT for the Operations approver to activate, **contract rates** (one per post type, from the quote's bill rates and the contract's operative share), and **sites** with their approved strength. No payroll record, pay rate, salary structure or posted payroll is touched.

## Choices I will make unless you say otherwise
1. The handover is created **automatically when a quote is accepted**, as a draft, and the salesperson is reminded to complete it; it is not created again if the quote is revised (the accepted version is the one that counts).
2. **Equipment** is a list of items with quantities per site (free text names to start), not a link to the inventory module.
3. **Service-level obligations** are recorded as structured lines (what, the time or measure, the consequence) plus free text; they feed the cases and SLA clocks of Phase 7 later.
4. **Operations accepts the handover** (the handshake): the Executive Director, Operations, or the Operations Manager, held as a designated list; never the person who prepared it.

## Founder's answers (2026-10-29)
1. **Who approves in Operations:** "there should be a handshake between Operations and Sales." Built as a two-sided sign-off: Sales submits, Operations accepts or returns it with questions, and nothing is created until Operations has accepted the version it read. Both signatures (who and when) are kept with the handover. **Who accepts (founder, later the same day): the Executive Director, Operations, or the Operations Manager.** WorkforcePay has roles, not job titles, so these two are held as a **designated list of acceptors** that the company administrator sets (the same way as the quote approvers): only a designated, active user who is not the maker can accept. The list is for those two posts; the company administrator can designate whoever holds them. A handover with nobody designated cannot be accepted.
2. **Contract on approval:** **draft** (Operations activates it separately).
3. **Client contact per site:** **yes**. Each site records the person we deal with on site (name, role, phone in E.164, email), stored with the handover and copied to the site on acceptance.

## Tests first (when you give the go)
Quote not accepted or approval missing means no handover; the draft is created once on acceptance; submitting needs every required item; the preparer cannot accept; Operations can return it with questions and Sales must resubmit; acceptance applies only to the version Operations read (a later edit voids it); both signatures are recorded; the contract is created as a draft; each site keeps its client contact; nothing exists before approval and exactly the records listed after it; rollback on a failure partway; rerunning approval creates no duplicates; the handover is frozen once approved; cost and margin never appear in it; permissions and organization isolation; audit entries carry ids and statuses only.
