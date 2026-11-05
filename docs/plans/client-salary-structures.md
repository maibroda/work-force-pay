# Plan: a salary structure for each client, with sub-structures for each job role

Written 2026-11-05 from the founder's request ("a salary structure is created for a client, and under it sub-structures: ABC Bank salary structure, then guard, supervisor, driver, cleaner under it") and the founder's four answers the same day. **This is a plan. It needs a database migration, so nothing is built until you say "go".**

## 1. What exists today (checked in the code)

- A salary structure (`SalaryStructure`) is a list of components with percentages. It belongs to the company, not to a client, and the list of structures is flat.
- The client link is made on the contract's **rate card** (`ContractRate`): client, contract, employee category, **one** salary structure, agreed rate. Payroll reads the structure from that rate (`rates.ts`). So "ABC Bank guard" and "ABC Bank supervisor" can already use different structures, but nothing groups them under "ABC Bank" and nothing stops a client's structure being used on another client's contract.

## 2. What you decided

1. Each client has its own salary structure (the parent), with **sub-structures per job role** under it; the rate card uses the sub-structure for that role.
2. A sub-structure is a **complete copy of the parent, then editable** (no inheritance at run time). Changing the parent later does not change a sub-structure.
3. **Both:** a structure may be owned by one client or be company-wide. The existing structures and the default stay company-wide.
4. The job roles are the **existing employee categories** (guard, supervisor, driver, cleaner).

## 3. The design

**Data (one small migration, reversible):** three optional columns on `SalaryStructure`: `clientId` (the client that owns it; empty means company-wide), `parentId` (the structure it sits under; empty for a top-level one) and `categoryId` (the employee category a sub-structure is for). Every existing structure keeps all three empty, so **nothing existing changes**. `down.sql` drops the three columns.

**Rules (checked on the server, each with a test):**
- A sub-structure has a parent, a category, and the same client as its parent. A parent must be client-owned and cannot itself be a sub-structure (two levels only).
- At most one active sub-structure per parent and category for the same dates (so the rate card can pick it without guessing).
- A client-owned structure can be used only on that client's contracts; a company-wide one on any. Today's rate cards are unaffected.
- Everything is scoped to the company; another company's structure is "not found".
- Creating, changing and switching a structure is audited with ids and the names of the fields changed.

**Where it shows:**
- **Salary structures page:** grouped as Company-wide, then by client with the sub-structures indented under their parent. Creating a structure asks "Owned by client" (optional); creating a sub-structure asks for the parent and the category, and offers "copy the parent's components" (on by default).
- **Rate card (Contract rates):** the structure list for a contract shows company-wide structures plus that client's; once the category is chosen, that client's sub-structure for the category is pre-selected.

**What does not change:** the payroll calculation. The rate card still holds exactly one structure per contract, category and period, and payroll reads it as before. So this is a data and screen change, plus one consistency rule on the rate card.

## 4. Order of work (tests first)

1. Tests for the rules above, the migration (down and up on a rolled-back copy), and "existing structures and rate cards behave exactly as before" (the golden payroll datasets must still pass).
2. Migration and service rules. 3. Screens. 4. Explain-back note, release notes, data dictionary.

## 5. An assumption I will make unless you say otherwise

The parent ("ABC Bank salary structure") is itself a **complete structure**: for a category with no sub-structure, the rate card may point at the parent directly. (The alternative, a parent that is only a heading and never used for pay, would force a sub-structure for every category.)

## 6. What this does not do

No change to payroll calculation, statutory rules, permissions or entitlements. It does not change any existing structure, rate or payslip. Anything outside this (for example inheritance that flows down from the parent) is a separate decision.
