# Survey results: closing the subtraction leak (explain-back note)

Written 2026-11-16 for the founder's approval of 2026-11-16 ("fix the subtraction leak"), the finding reported in `survey-hardening-explain-back.md`. **No money, pay or statutory setting is touched; no migration; nothing about how an answer is stored changes.** This changes only which groups the results page may show.

## What the code does, step by step

1. The results page breaks a survey down by role (and by department). A group is **shown on its own** only if **ten or more** people were invited in it **and five or more** answered. Every other group is **combined** into one "other" row, and that row is shown only if **it** is also large enough (ten invited and five answers).
2. The whole survey's figures are shown from five answers. So **"other" is exactly the whole survey minus the groups shown on their own**: anyone can subtract.
3. **The old rule** protected against that only when **exactly one** group was hidden: it then also hid the smallest shown group. With **two or more** small groups hidden, and their combined row still too small, the combined row was left "not shown" while the shown group stayed on the page, so the combined row's ratings were the whole survey minus the shown group.
4. **The new rule:** if there is anything hidden and any group still shown, and the hidden ones **together** are not large enough to be shown, **the smallest shown group is combined with them**. That group is large enough by itself, so the combined row now is too, and **one group is always enough**. If nothing is shown on its own, nothing changes.

## Where the rule comes from

The founder's approved rule of 2026-11-14 (no leak through small groups) and the existing thresholds (ten invited, five answers). The only new thing is that the check is made on the **combined hidden row**, not on **the number of hidden groups**.

## Worked example

A survey invites **12 guards, 3 office staff and 4 supervisors**; all answer (guards rate 5, office 1, supervisors 2). Guards are large enough to be shown; the office (3) and supervisors (4) are not, and **together (7 invited) they are still not**. **Before:** the page showed the guards and "other roles: not shown"; but the whole survey is 19 answers and the guards are 12 fives, so the seven others were exactly three 1s and four 2s. **Now:** the guards are combined with them, so the page shows **no role on its own** and one combined row of **19 invited and 19 answers**, which is the whole survey and reveals nothing more.

## What could go wrong

- **Some pages show less than before.** A survey with a large group and two or more small groups, which used to show the large group on its own, now shows it combined. That is the cost of the fix, and the same cost the old rule already accepted when exactly one group was hidden.
- **Role and department are checked one at a time.** Someone who compares the role breakdown with the department breakdown could still narrow a small cell by comparing them. This is **not** closed here; I have not tried to measure it. It is a possible next review item.
- **A tie between the smallest shown groups** takes the first in the list. It makes no difference to the protection.

## Tests that prove it (written first; five failed without the code)

`tests/unit/survey.test.ts`: the finding's own figures (A 30 invited and 20 answers, B 3 and 2, C 4 and 2 now give one combined row of 37 and 24); only the smallest shown group is taken when that is enough; no group is shown with nothing hidden; and **3,000 random sets of groups** each check that nothing is lost or counted twice, that every group shown on its own is large enough, and that **a combined row next to a shown group is itself large enough**. `tests/integration/survey-hardening.test.ts`: the same through the real results page. **One existing test had to change:** "shows nothing for the combined row when it is still too small" expected the leaking result for the data guards 40/20, supervisors 6/5, office 3/2. It now uses data with no group shown for its original purpose, and the leaking case is a new test with its new expected result. This is a change of what a test expects, made because the founder approved changing exactly that behaviour; the existing survey (29) and anonymity (15) integration tests pass unchanged.
