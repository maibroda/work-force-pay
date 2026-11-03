# Plan: PAYE by state of residence, PAYE dates and penalty, and safer effective dates

**Status: stages 1, 2 and 3 are built on branch `paye-by-state`, with the recommendations taken: (1) a worker with no state is warned about and goes on a "State not recorded" line, nothing is blocked; (2) the rule for which date decides the state is the adviser's and is NOT decided: the state recorded on the employee when the payroll is calculated is used; (3) no filing date or penalty value is entered, the adviser supplies them; (4) overlap protection is service-level only; (5) stages in order. Correction found while building: the creation paths already refused a new version when an OPEN version started on or after it, so stage 3 only closes the gap for ENDED versions, and also covers pension and employer-contribution versions published to clients.**

**Default decisions now editable (branch `editable-defaults`):** a missing state is a warning by default and can be made blocking by a payroll rule switch; the filing dates start from the founder's own PAYE seed values, proposed in the new-version form and labelled unverified; the state-of-residence date default is "the state on the employee at calculation" (adviser to confirm).

*Original status:* a plan for the founder's "go". Nothing in it had been built. It touches the statutory module, the payroll record and remittances, and needs migrations, so `CLAUDE.md` says it waits for your "go" (rules 3, 7, 14).

**Rules it serves:** rule 3 (statutory settings are effective-dated data, verified, never hard-coded), rule 5 (tenant isolation, audit), rule 7 (reversible, non-destructive migrations), rule 13 (Nigerian filing practice). The product description says PAYE is assigned to the worker's **state of residence**.

## 1. Where this came from

You sent three files for a separate PAYE design: a PostgreSQL migration (`001_paye_settings.sql`), a 2026 seed (`002_seed_nta_2026.sql`) and a test file (`nta.paye.test.ts`, which imports a module, `../src/index.js`, that was not sent, so I could not run it). I chose "extend ours": I do **not** add their tables, because we already have effective-dated tax rules, bands, reliefs, exemptions, a rule library with HR and Finance sign-off, and a verified-settings gate. A second set of tables would be a second source of truth (rule 1). I take their **ideas** and their **checkable examples**.

## 2. What exists today (read from the code and schema)

| Topic | Today |
| --- | --- |
| Tax rules | `TaxRule`, `TaxBand`, `TaxRelief`, `TaxExemption`, per organization, effective-dated, versioned. The bureau's rule library proposes, verifies (HR and Finance both) and publishes them; "verified" is derived from a content fingerprint (`fingerprintOf` in `rule-library.ts`). |
| State of residence | **Does not exist.** `Employee` has an address and a tax ID but no state; `PayrollRecord` has `taxId` and `pfa` but no state. |
| PAYE remittance | `generateRemittances` writes **one** line for all PAYE, payee "State Internal Revenue Service (PAYE)". Pension is already split per PFA. |
| PAYE due date, annual return date, late penalty | **Not in the code.** |
| Overlapping rule versions | Nothing stops two rules being in force on the same date. |
| Verified rules locked in the database | No. A changed rule is **detected** by the fingerprint (and blocks payroll), but the row can still be edited. |

## 3. The design, in stages (each its own pull request, each waits for your "go")

### Stage 1: state of residence and PAYE by state (the gap the golden key already expects)
- **Employee** gets `stateOfResidence` (nullable text, one of the 36 states or FCT, kept as a fixed list in the code; a typed value like "ogun" or "abuja" is recognised and stored as the proper name).
- **PayrollRecord** gets `payeState`, copied from the employee when the payroll is calculated, so a locked payroll never changes if the employee moves later (same reason `pfa` is copied).
- **Remittances:** `generateRemittances` writes **one PAYE line per state** (payee "<State> Internal Revenue Service (PAYE)"), exactly as pension is split per PFA. The lines add up to the PAYE total; a test proves it. A worker with PAYE and no state goes on a line "State not recorded" so nothing is lost.
- **Screens:** the employee form and the employee import take the state; the PAYE schedule report shows the state and groups by it.
- **Missing state:** see question 1.
- **Migration:** two nullable columns, no data rewritten. Reverse = drop the two columns (written and tested on a copy). Old locked payrolls keep an empty state.
- **No pay figure changes.** Only the grouping of PAYE changes.

### Stage 2: PAYE due date, annual return date, late penalty (as rule data)
- New **nullable** fields on `TaxRule`: day of the following month PAYE is due, annual return month and day, late penalty percentage. They are effective-dated with the rule and go through the rule library like the bands.
- Each PAYE remittance line shows its **due date** from the rule in force, and a list shows overdue lines with the penalty on the unremitted amount. Interest is **not** modelled (no rate has been supplied).
- **The fingerprint** must include the new fields **only when they are set**, so every existing rule keeps the fingerprint it was signed with and no payroll is blocked by this change. A test proves an old signed rule still counts as verified.
- The files suggest 10th of the following month, 31 January and 10%. They say themselves "published summaries" and "unverified until a tax adviser signs off". **I will not enter values from memory or from the files**: the adviser supplies them and they go through the library. Until then the due date shows "not set".

### Stage 3: no two rule versions in force on the same date
- A check when a rule is proposed or published: for the same organization and code, the effective dates must not overlap, with a plain message. This is service-level (no extension needed).
- Optional (question 4): also a database exclusion constraint, which needs the `btree_gist` extension.

### Stage 4 (suggested, not planned yet): lock verified rules in the database
Their migration refuses any edit to a verified row. Ours would need to know which rows came from a verified release, including the copies in client organizations. That is a larger design; I recommend leaving it, since the fingerprint already blocks payroll on any change.

## 4. Tests first (taken from the files, re-derived by me)

I checked these by hand against the bands we have; they are good acceptance tests for the existing PAYE code and need no change to it:
- Tax on a chargeable income of ₦3,000,000 = ₦330,000.00; ₦3,000,001 = ₦330,000.18; ₦12,000,000 = ₦1,950,000.00; ₦25,000,000 = ₦4,680,000.00; ₦50,000,000 = ₦10,430,000.00; ₦60,000,000 = ₦12,930,000.00.
- Rent relief, the lower of 20% and ₦500,000, rounded half up: rent ₦2,499,999.99 gives ₦500,000.00; rent ₦2,499,999.90 gives ₦499,999.98.
- Minimum wage boundary: gross ₦70,000 a month is exempt; ₦70,001 is taxed, annual ₦6,001.80, monthly ₦500.15.
- State grouping: "ogun" and "Ogun" are one line; "abuja" is FCT; an unknown state is refused; 37 places in the list; line amounts add up to the PAYE total.
- Tenant isolation: one organization's remittance lines never include another's workers.
- Stage 2: due date for March 2026 PAYE (if the rule says the 10th) is 10 April 2026; an old signed rule keeps its fingerprint.
- Stage 3: two overlapping versions are refused; adjacent ones are fine.

## 5. Security and data

No secrets, no real data. All changes are audited like other rule and employee changes. The state is not sensitive on its own, but the employee list already needs the existing permissions. No change to sign-in.

## 6. What I need from you

1. **Employee with no state:** warn on the payroll page and put the PAYE on a "State not recorded" line (my recommendation, nothing stops pay), or **block** submitting a production client's payroll until every taxed worker has a state (like the verified-settings gate)?
2. **State of residence rule:** which date decides the state (for example the pay date, or the start of the tax year), and how is a worker posted in one state and living in another handled (golden case 7 says Lagos for a Lagos resident)? This is the adviser's call; I will not guess.
3. **Stage 2 values:** the adviser's due day, annual return date and penalty percentage, and whether interest must be shown.
4. **Overlap check:** service-level only (my recommendation) or also a database constraint (needs the `btree_gist` extension, a database dependency, and the host is not chosen yet)?
5. **Order:** stage 1 first, as I recommend, then 2 and 3?
6. **Still open from before:** the five rule differences between the golden key and the engine (NHF deduction, net-pay floor, allowances during absence, overtime base, rounding of basic and allowances), the adviser sign-off on the golden settings, the collaborator invite for `developeraideehem`, and branch protection on `main`.

## 7. Risks and what I will not do

- A new required-looking field can annoy data entry: hence question 1.
- Splitting PAYE by state changes the remittance screen and any export people already use; the total does not change.
- I will not adopt their tables, enter any statutory value, change a PAYE figure, add interest, or touch sign-in.
