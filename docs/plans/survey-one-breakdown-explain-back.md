# Survey results: one breakdown per survey (explain-back note)

Written 2026-11-17 for the founder's choice of 2026-11-17 ("go with option A") after the measurement of the role-versus-department leak. **No money, pay or statutory setting is touched.** It changes **what a survey's results show and what is stored on an answer**. One additive migration.

## The leak this closes (measured on 2026-11-17, with the real code)

A survey with **25 guards** (20 in Operations who all rated 4, and 5 in "Dept C" who all rated 1) and **12 office staff** (all rated 3). Each view obeyed the rules by itself: by role it showed Guards (25) and Office (12); by department it showed Operations (20) and "other departments combined" (17 invited, 5 ones and 12 threes). **Read together:** *Guards minus Operations* is five 1s, and *other departments minus Office* is the same five 1s. So **the five people in Dept C (below the ten-invited rule) were recovered as "all five rated 1"**. HR holds the employee records, so HR knows who those five are.

## What the code does now, step by step

1. **HR chooses, when creating a survey, whether its results are broken down by role (the default) or by department. Never both, and not changeable afterwards.**
2. **The results show only the chosen breakdown.** The other is empty. This also applies to a result **kept** after the raw answers were deleted: if it was kept from before this change and holds both, **only the chosen one is returned**.
3. **What is stored on an answer follows the choice.** An answer carries its **role** (a role survey) **or its department** (a department survey), **never both**, and only when ten or more people were invited in that group (the earlier hardening). The unused dimension is **not stored at all**. The access-code rows still hold both (the invited counts come from them).
4. **Every rule inside a breakdown is unchanged:** nothing below five answers, a group only with ten invited and five answers, smaller groups combined, and the complementary suppression (including the fix of #208).
5. **Existing surveys** take **role** by default (a migration default), so their results lose the department view; nothing else changes.

## Where the rule comes from

The founder's approval of 2026-11-14 (no identification through small groups) and the choice of 2026-11-17 (option A, one dimension per survey, role by default).

## Worked example

HR creates "Working here, November" and chooses **department**. The results show Operations (20) and "other departments combined"; **there is no role view**, so there is no second view to subtract from the first, and Dept C's five people cannot be recovered. A second survey for the same staff, chosen as **role**, shows Guards and Office and **no department view**. **Both surveys use the same staff and the same answers; neither can reveal Dept C.**

## What could go wrong, and what I did not do

- **HR can no longer see the role and the department for the same survey.** That is the cost. To see both, HR runs two surveys, and **comparing the same group across two surveys is a separate risk I have not measured** (the same people answering twice, with different breakdowns).
- **A survey made before this change and closed loses its department view** (it shows the role). Results already purged keep their stored summary, but only the chosen (role) breakdown is returned.
- **The choice is fixed at creation.** If HR picks wrong, the survey must be recreated; nothing can be changed after answers exist, on purpose.
- **Participation by role** on the survey page (how many were invited and took part, never what they said) is unchanged.
- **Not covered:** anyone reading the database directly (backups, logs); and the comments, which are a separate matter (#206).

## Tests that prove it (written first)

`tests/integration/survey-breakdown.test.ts` (8), built on the exact case measured: the default is role and nothing else than role or department is accepted, HR only; a pre-existing survey defaults to role; **a role survey returns no department figures and names no department; a department survey returns no role figures and names no role; whatever the survey, never both**; nothing is shown below five answers; a kept result holds only the chosen breakdown; **an answer stores the role only (role survey) or the department only (department survey)**. **One existing test changed its expectation:** in `tests/integration/survey-hardening.test.ts`, "stores a group's role and department independently" asserted that both were stored on one answer; it now asserts the **chosen one only** (the old behaviour is exactly what is removed). The other existing survey tests (survey, anonymity, hardening, unit) pass unchanged: 82 survey tests pass together. **Browser check (local demo company, synthetic data, removed afterwards):** a closed department survey with 60 answers showed "Broken down by department only", a department view and **no role view**; the new "Break the results down by" choice appears on the creation form, defaults to role, and the choice reached the database.
