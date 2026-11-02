# CRM Phase 9b plan: roles, limits, paging, indexes and the security review

**Status: built on branch `feature/crm-phase-9a` (on top of 9a, uncommitted) after the founder's "continue" (2026-10-30).** Phase 9 was split: 9a was privacy; this is the rest of Phase 9. The security review is a separate document, `09b-security-review.md`, and waits for your approval before anything is changed because of it.

## What the pack asks, and what is built

1. **Roles, enforced in the data layer, with tests per role.** Built as a **role matrix test** (`tests/integration/sales-role-matrix.test.ts`): it pins which role holds which sales permission, then runs 27 operations (reads, writes, cases, settings, automation, data requests) as every one of the 12 roles and checks that exactly the roles holding the permission get in, and that the others are refused *for the permission*. It also checks that a refused role leaves nothing behind and shows what each role sees (own records, everyone's, nothing of another organization). **No role was changed.**
2. **Rate limits** (`src/lib/rate-limit.ts`, in the memory of one server): the **public unsubscribe address** (page and one-click address) 30 a minute for each visitor address; **downloads** (CSV exports, report CSVs, data-request files) 10 in five minutes for each person; **email sent from the module** 60 an hour for each person (a refused marketing message is not counted; automation rules are exempt). A refused call is not counted, so waiting the time given always works; the number of keys is bounded.
3. **Pagination and caps on list endpoints.** Leads, accounts, contacts and deals are now **paged (50 a page, never more than 100)** with Previous and Next, and a total; the old behaviour (first 500) remains for the pickers that fill drop-downs. Handovers, which had no limit, are capped at 500. **CSV exports are capped at 20,000 rows** and the audit entry says when the cap was reached. A nonsense page number is the first page.
4. **Indexes for every list filter.** 16 indexes (migration `20261112090000_sales_list_indexes`, indexes only, reversible, round-tripped): the account, contact, lead and deal lists and their orderings, the deal board by pipeline, quiet deals, cases by date and by contact, handovers by date, activities by date, tasks by lead, contact and account, and notifications by date.
5. **The security review (Appendix B):** `09b-security-review.md`.

## The pack's roles against what the app has (please decide)

| The pack's role | What the app has | Difference |
|---|---|---|
| Sales rep: own leads, deals, activities; read accounts they own **or are on the team of** | `BUSINESS_DEV`: own records only | **There is no team.** A rep never sees a colleague's account. |
| Sales manager: everything for **their team**; approves below-margin quotes | No such role. `COMPANY_ADMIN` is the only role that can both change records and see everyone's. Approvers are people **designated** under Sales Settings (any user). | No "manager" below the administrator; "their team" is the whole organization. |
| Account manager: own accounts, cases, renewals | No separate role: `BUSINESS_DEV` owns accounts and may open cases | Same as a rep. |
| Operations: read **won** deals and handovers; act on handovers and cases | `OPERATIONS`: reads **every** sales record, accepts handovers (if designated), acts on cases | **Broader read**: Operations also sees leads, contacts and open deals (exports are masked). |
| Finance: read accounts, contracts, quotes, health; no edit | `FINANCE`: reads every sales record, no edit | **Broader read**, same as Operations. |
| Tenant admin: configuration | `COMPANY_ADMIN` (and `SUPER_ADMIN`): everything | As asked; also the only holder of data-request powers. |

**Questions for you:** (1) do you want a **Sales Manager** and an **Account Manager** role, and a **team** (a manager sees the reps assigned to them)? That is a schema and permission change, so I have not done it. (2) Should Operations and Finance see **only won deals, accounts and handovers**, not leads and open deals? Narrowing is easy; it would remove the pipeline from Operations' view.

## Not done, and why

- Rate limiting is **per server**; a limit at the proxy is needed when hosting is chosen.
- The role changes above (waiting for your answer).
- Anything from the review (waiting for your approval of the list).
