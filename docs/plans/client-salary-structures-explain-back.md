# Explain-back note: a salary structure for each client, with role sub-structures

Branch `client-structures-build`. One small migration, `20261123090000_client_salary_structures` (three optional columns on the salary structure). **The payroll calculation is not changed.** This touches how a rate card chooses a structure, so it needs your review. Built on the founder's answers of 2026-11-05 (`docs/plans/client-salary-structures.md`).

## What it does, step by step

1. **A structure can belong to a client.** Three optional columns on a salary structure: the client that owns it, the structure it sits under, and the job category (guard, supervisor, driver, cleaner: the existing employee categories) a role structure is for. **Every existing structure keeps all three empty, so it stays company-wide and nothing changes for it.** The company's default structure can never be given an owner.
2. **A client's structure.** On the Salary structures page, "Create a salary structure for a client" makes, for example, "ABC Bank salary structure": a copy of the structure you pick (the company's default if you pick none), owned by that client, starting as a draft. The structure it copies is not touched.
3. **Role structures.** On a client's structure there is "Add a role structure": choose the job role and a code. It is a **complete copy of the client's structure**, owned by the same client, for that category, starting as a draft that can be edited. **Changing the client's structure later does not change a role structure** (no inheritance).
4. **Rules, checked on the server.** A role structure needs a parent that belongs to a client; there are only two levels (a client's structure, then its role structures); the category must be one of this company's; a role structure belongs to its parent's client; a category can only be given to a role structure. **Only one role structure can be active for a client's structure and category**; to switch to a new version, switch the old one off first. Cloning a role structure keeps the clone under the same parent and category.
5. **The rate card.** A client's structure can be used **only on that client's contracts**; a company-wide structure on any. A role structure can be used **only for its own category**. If the structure is left blank on a rate, the system uses **the client's active role structure for that category**, and says so if there is none. The same client rule applies to a contract's default structure.
6. **Payroll is unchanged.** The rate card still holds exactly one structure per contract, category and period, and payroll reads it as before.
7. **Audit and isolation.** Creating a structure is logged as before. Everything is looked up in the caller's company, so another company's structure, client or category is "not found". Creating needs the structure permission.

## A worked example

ABC Bank's structure: Basic 60%, Housing 40%. You add role structures: **Guard** (kept as the copy) and **Supervisor** (edited to Basic 50%, Housing 30%, Transport 20% before activating). On ABC Bank's contract the rate card gives a guard an agreed rate of ₦100,000 and a supervisor ₦150,000, each with the operative share of 70%: the guard's gross is ₦70,000, split Basic ₦42,000, Housing ₦28,000; the supervisor's is ₦105,000, split Basic ₦52,500, Housing ₦31,500, Transport ₦21,000. If someone tries to put ABC Bank's Guard structure on XYZ Plc's contract, or on the supervisor category, the system refuses and says why.

## What could go wrong, and what proves it does not (`tests/integration/client-structures.test.ts`, `tests/unit/structure-groups.test.ts`)

| Risk | Test |
| --- | --- |
| A client's structure is used on another client's contract | "lets a client's structure be used only on that client's contracts…" |
| A role structure is used for the wrong category | the same test |
| A role structure points at a company-wide structure, a grandchild, another company's rows, a missing category or the wrong client | "holds to the rules…" |
| Two role structures are active for one client and category | "allows only one ACTIVE role structure…" |
| The role structure follows later changes to its parent | "makes a role structure as a complete copy…" (parent changed afterwards, child unchanged) |
| Existing company-wide structures and rate cards change | "leaves existing rate cards exactly as they were" and "creates a client's structure…" (the default is unchanged) |
| Another company reaches this company's structures | "company isolation" |
| The migration loses a structure | round trip on a copy: down then up, all 34 test structures still company-wide |
| Payroll changes | the golden payroll datasets run unchanged in the full suite |

## What I did not do or test

- **Role structures do not inherit:** changing a client's structure does not update its role structures (your decision). There is no "apply this change to all roles" shortcut.
- On the rate card form the structure is chosen from a list that now shows whose it is ("ABC Bank › …"); a wrong choice is refused by the server with a clear message rather than hidden from the list.
- **Not built:** moving an existing company-wide structure to a client, and the office-staff structure percentages (waiting for your adviser).
- I checked the screens in a browser against a scratch database (see the pull request); not every role.

## Addendum (2026-11-05): giving an existing structure to a client

On a company-wide structure's page, "Give this structure to a client" sets its owner and changes nothing else (the components stay). The rule it must keep is that a client's structure is used only on that client's contracts, so the server **refuses**, naming the client, if the structure is already used on another client's contract rate or as another client's contract default, and refuses if employees' **personal pay rates** or pending proposals use it (those are not tied to a client). The default structure can never be given to a client; a structure that already belongs to a client, or a role structure, is not moved; it is logged by ids. **Related fix:** a client's structure is also no longer accepted for a personal pay rate (a proposed gross, the import's Salary Structure column) or offered in the employee form. Tests: `tests/integration/assign-structure.test.ts`.
