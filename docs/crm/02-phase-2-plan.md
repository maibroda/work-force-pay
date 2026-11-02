# CRM Phase 2 plan: duplicates, merge, lead conversion, assignment, pipelines, import

**Status: Phase 2a is BUILT (#96); Phase 2b (import, export, account and contact pages) is BUILT on branch `feature/crm-phase-2b`, stacked on #96.** Founder's instruction "continue with CRM Phase 2" (2026-10-29) is taken as the "go", including the migration. The pack's Phase 2 is large, so it is delivered as two pull requests, each with its own report.

| | Delivers | Migration |
| --- | --- | --- |
| **2a** | duplicate detection, merge of accounts and contacts, lead conversion, owner assignment rules, the pipeline, stage, stage-history and deal tables with the default "New business" pipeline, simple mode, a lead page with the convert form | `20261106100000_sales_pipelines_conversion` (additive, reversible) |
| **2b** | CSV import with preview and downloadable error file, CSV export, account and contact pages with related lists | none |

## Choices I made (each is changeable; say so)

1. **Duplicate checks never leak.** A sales person's check searches the whole organization, but for a match owned by someone else they are told only "a matching record exists, owned by <name>: ask them or a manager", with no company, phone or email. A manager sees all matches.
2. **Nothing is merged without a manager.** Merging needs `sales.view.all` plus `sales.manage` (it moves other people's records). The survivor keeps its values except where it is empty (then the other's fills it) or where the manager picks the other's value field by field. The merged-away record is voided and points to the survivor; nothing is deleted.
3. **Consent survives a merge and a conversion, and never loosens.** Consent rows cannot be edited, so a merged contact's consent is read from the survivor **and everything merged into it**, latest first. When a lead is converted, a **withdrawal always carries over**; a **grant carries over only if the contact has no consent record for that purpose yet**, so an old grant on a lead can never override a withdrawal the contact made.
4. **Automatic owner assignment applies to leads created by a manager or administrator with no owner given** (and to imports in 2b), never to a sales person's own entry (they own what they add). Methods: round robin among active sales people, by state, by service wanted; a state or service with no rule falls back to the creator. Every assignment is audited (ids and the rule used).
5. **Conversion is one all-or-nothing step.** New records copy the lead's fields (source and source detail travel with them); an existing account or contact is only **filled where empty**, never overwritten, and its owner never changes. A converted lead is read-only.
6. **Simple mode** (every enquiry is real): leads are refused with a message; a deal is added directly on an account.
7. **Money**: deal value is `Decimal(16,2)`, accepted with at most two decimals (never silently rounded). Weighted values come in Phase 3.
8. **Default pipeline** "New business" (Lead in, Qualified, Site survey, Proposal sent, Negotiation, Contract signing, Won, Lost; probabilities 10, 20, 35, 50, 70, 85, 100, 0) is created the first time the module is switched on. Stages store their required fields now; they are enforced in Phase 3. The Renewal and Rate review pipelines come with Phase 7, where they are used.

## Tests first
Duplicate rules (including "ABC Security Ltd" vs "A.B.C. Security Limited", free-mail domains ignored, phone and email matches); no leak to a sales person; merge (survivor wins, fills empties, re-points, consent history kept, manager only); conversion (new/new/new, into an existing account, into an existing contact, no deal, fill-only-empty, owner untouched, rollback on a failure partway, consent carry rule, read-only after); assignment (round robin, by state, by service, fallback, audit); pipelines (default created once, per organization, history row on a new deal); simple mode; isolation per new table.

## Not in Phase 2
Stage gates and the Kanban board (Phase 3), activities (Phase 4), handover (Phase 5).
