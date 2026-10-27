# Plan: block a payroll run when a required statutory setting is unverified

**Status: built on the founder's "go for the verified-settings gate".** The "go" did not answer the questions of section 7, so I took my recommendations: derive "verified" from the library with no migration; gate bureau clients whose engagement is ACTIVE; the HR and Finance sign-off, with its note, is the "adviser" verification; no override; old rule versions must be verified for back-dated runs; baseline rules that were never put through the library are unverified. **Two departures from the plan, both small:** (1) a release counts as verified when it is VERIFIED or PUBLISHED with both signatures and the content matches (publication only distributes a rule, it does not change whether HR and Finance signed it); (2) the demo client is made ACTIVE by a direct update of its engagement status after its rules go through the real library steps. Original status: a plan for the founder's "go". It changes how payroll runs behave (it can stop one), and `CLAUDE.md` rule 3 says this is a decision for you, not me.

**Rule it serves:** rule 3 ("Statutory settings are data, not code ... effective-dated settings with version history, who changed them and when, and an 'adviser verified on/by' field. Payroll for production clients must be blocked if a required setting is unverified"). It also serves rule 5 (a blocked run is a security event, so it is logged) and rule 8 (a new behaviour that can stop work is introduced carefully).

## 1. Rule 3, line by line: what exists today

| Rule 3 says | Today | Gap |
| --- | --- | --- |
| Tax bands, exemptions, reliefs, pension rates and bases, NHF, NSITF, ITF rates are data, not code | **Met.** PAYE bands, reliefs and exemptions (`TaxRule`), pension (`PensionRule`) and employer contributions including ITF, NSITF and NHF/medical (`EmployerCostRule`) are database tables. | none |
| Effective-dated | **Met.** Every rule has `effectiveFrom` and `effectiveTo`; a run uses the rule in force on the period's end date. | none |
| Version history | **Met.** A new version is a new row; the run records which version it used. | none |
| Who changed them and when | **Met for the bureau.** Proposing, verifying, publishing and withdrawing are all in the audit log. A client cannot edit its PAYE or pension rules (`assertNotBureauManaged`). | none found |
| "Adviser verified on/by" | **Partly.** The bureau's rule library needs one sign-off from HR and one from Finance (neither the proposer), each with a note of what the rate was checked against, and a checksum pins exactly what was verified. | The sign-off is on a *release record*, not on the rule rows a client's payroll reads, and it does not say "adviser". |
| **Payroll for production clients must be blocked if a required setting is unverified** | **Not met.** `runPayroll` loads the rules in force and calculates. It never asks whether they were verified. | **This plan.** |

## 2. What I found (read-only inspection, nothing run against real data)

1. **The run never checks verification.** `runPayroll` and `createSupplementaryRun` read the PAYE, pension, payroll and employer-contribution rules for the period end date and calculate. The only place I found verification being looked at is the **launch checklist**, which shows "rate tables verified" as done or not, and does not stop anything.
2. **A client's rule and the verified release are linked only by content.** When a release is published, the rule is copied into each client with the same code, version and date. A publication is recorded (`RulePublication`), **but a client onboarded after publication gets its rules by copy (`copyStatutoryRules`) and no publication record is written.** So "has a publication record" would wrongly call those clients unverified. The reliable test is: *is this client's rule, by content, identical to a rule version that HR and Finance verified and the bureau published?* The existing checksum (a fingerprint of the bands, reliefs, exemptions and rates, ignoring end dates) does exactly that, and is already used to stop a master rule being edited after sign-off.
3. **Someone with database access could change a client's band after the fact.** The app stops a client editing its PAYE rules, but nothing at run time notices a band changed underneath. A content check at run time closes that.
4. **The onboarding code treats a "baseline" as acceptable.** `startingRuleIds` lets a new client start with rules the bureau is already paying on that were *never* put through the library. The launch checklist calls the same rules "never put through verification" and marks the check as not done. These two disagree. Under this plan a baseline rule is **unverified** until it goes through the library, which matches rule 3 and the checklist.
5. **There is no "production" flag.** A bureau client has an engagement with a status (`ONBOARDING`, `ACTIVE`, `PAUSED`, `ENDED`). The demo and test organizations are not bureau clients at all.
6. **Required settings.** Rule 3 names tax, pension, NHF, NSITF and ITF. Those are the three kinds the library already covers (PAYE, pension, employer contributions). The fourth rule table, `PayrollRule` (proration basis, overtime multiplier, standard hours, default operative share), is **business policy, not statute**; I do not treat it as required.
7. **The seed has no releases.** The demo and acceptance tests run a payroll on rules that were never verified. A gate has to be on only where it is meant to be, and the seed has to go through the real verification steps for the one demo client that is gated, so the demo and the tests still run.

## 3. The design (recommended)

**Derive "verified" from what already exists. No new database columns, no migration.**

- **A rule is verified** when its fingerprint equals the checksum of a release at the client's bureau that is **PUBLISHED** (which already means both HR and Finance signed, and neither was the proposer) and **not withdrawn**, and whose kind and version match. Anything else is unverified: never proposed, proposed but not fully signed, withdrawn, or changed since it was signed.
- **A "production client"** is a client organization of a bureau whose engagement is `ACTIVE`. Clients still `ONBOARDING` (being set up and tested), `PAUSED` or `ENDED`, the bureau's own organization, and organizations that are not bureau clients are **not gated**, but the run page shows a plain warning ("PAYE v2026.1 has not been verified by HR and Finance") so it is never invisible.
- **Required kinds:** PAYE, pension, employer contributions. For a run, the rule in force on the period's end date is checked for each kind. A missing rule is also a stop (there is nothing to calculate with).
- **Where it stops:** calculating a regular run, creating a supplementary run, and again at **submit, approve and lock**, so a rule that is changed after the run was calculated cannot slip through on an old calculation.
- **The message names the problem and the fix**, for example: "This payroll can't run: PAYE NTA v2026.1 (from 1 Jan 2026) has not been verified. HR and Finance must verify it in the Statutory Rule Library, and the bureau must publish it."
- **Every block is recorded** in the audit log (who tried, which client, which rule, why) as a security event.
- **No override.** There is no "run anyway". Verification takes minutes in the library, and an override is exactly the thing the rule is there to prevent. If you want a break-glass route, it would need a second person and a reason, and I would plan that separately.
- **The rule pages show who verified what and when** (HR and Finance names, dates and notes, read from the release), so "verified on/by" is visible next to each rule a client holds.
- **The demo:** the seed will run the real propose, verify (HR and Finance) and publish steps for the master rules and set the demo client `ACTIVE`, so it is gated and passes for the right reason.

## 4. The alternative, and why I do not recommend it first

Put `verifiedAt`, `verifiedBy`, a note and a checksum **on every rule row**, with a per-organization switch, so any organization (including a standalone one that is not a bureau client) can be gated. It matches the wording of rule 3 most literally. It needs a database migration (additive, not destructive) and a back-fill of every existing rule row. I recommend it **only if you plan to sell WorkforcePay to companies that run their own payroll without a bureau**. For ThreeRoots, where every production client is a bureau client, the recommended design gives the same protection without touching the schema. If you choose this one, I will write it as a separate plan with the migration for your approval.

## 5. Order of work (tests first)

1. **Pure rules, tested without a database:** given the in-force rules and the bureau's releases, which are verified, and why not. Cases: verified; never proposed; proposed with one signature; verified by both but not published; withdrawn; changed after signing (fingerprint mismatch); two releases of different versions; a missing kind; a baseline rule.
2. **Service tests against the test database:** a gated client is **blocked** with each kind unverified; **allowed** once verified and published; **blocked again** if a band is changed directly in the database after verification; a client still onboarding is **not blocked** but warned; a standalone organization is not gated; the supplementary run, submit, approve and lock are also stopped; a block is written to the audit log; one client's verification never verifies another's (tenant isolation); a client onboarded after publication is recognised as verified without a publication record.
3. **Implement** the check, wire it into the run, supplementary run, submit, approve and lock, and add the warning and the "verified by / on" display.
4. **Seed and acceptance tests** updated to go through the real verification steps.
5. **Full suite, lint, type check;** a before-and-after on the seeded payroll (no figure may change); release notes, rule 3 status in `rules-conformity.md`, the data dictionary (no schema change expected).

## 6. What this does to existing behaviour

- **No pay figure changes.** It only decides whether a run may proceed.
- **A production client's payroll will stop** until its in-force PAYE, pension and employer-contribution rules are verified and published. For ThreeRoots, with no client live yet, this costs nothing today; it removes the risk of going live on an unchecked rate.
- **Locked and paid payrolls are not touched.**
- **Back-dated runs:** a run for an old period uses the rule in force back then. If that old rule was never put through the library, the run is blocked until it is (the library accepts any rule version). I think that is right, but you may prefer a cut-off date before which history is not checked (question 5).

## 7. What I need from you

1. **Recommended design (derive from the library, no migration) or the alternative (verification fields on every rule row)?** Section 4.
2. **"Production client" = a bureau client whose engagement is `ACTIVE`.** Is that the moment you want the gate to apply? Or should it apply from `ONBOARDING` as well?
3. **"Adviser verified on/by."** Today the sign-off is HR and Finance staff, with a note of what the rate was checked against. Is that what you mean by "adviser", or must the note name an external tax adviser and the date the adviser confirmed (I would require it in the note)?
4. **Is the gate allowed to stop a run with no override** (my recommendation), or do you want a two-person, reasoned break-glass route?
5. **Back-dated runs:** require verification of old rule versions too (recommended), or only for rules in force from a cut-off date you give?
6. **Baseline rules:** treat in-force rules that were never put through the library as **unverified** (matches rule 3 and the launch checklist; the existing onboarding code treats them as acceptable)? Recommended yes. It also means the bureau must run its current rules through the library once before the first client goes `ACTIVE`.
7. **Still open from before:** the golden dataset (CSV), the independent reviewer's GitHub username (CODEOWNERS, rule 11), your hand check of a tie, the adviser on the NHF relief and the settlement rounding choices, the ITF/NSITF base, and whether the engine keeps refusing part-kobo input.

## 8. Risks and what I will not do

- **A gate that can stop payroll is only safe if the way to unblock it is easy.** The library already makes that quick; the message points to it.
- A bug in the check could block a legitimate run. That is why the tests include every case above and why the gate applies only to `ACTIVE` clients.
- The content check trusts that the fingerprint covers everything that decides a rule. It already covers bands, reliefs, exemptions, rates and the pensionable codes; I will add a test that changing each of those one at a time changes the fingerprint.
- I will not change any rate or rule, the verification process itself, or the engine, and I will not touch locked or paid payrolls.
