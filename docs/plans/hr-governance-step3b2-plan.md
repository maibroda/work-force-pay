# Plan: governance step 3b-2, the retention run (the destructive half)

Written 2026-11-13. **Status: built on 2026-11-13 (branch `governance-step3b2`) on the RECOMMENDED answers to every question in section 5, because the founder said "go with governance step 3b-2" without answering them.** The explain-back note `hr-governance-step3b2-explain-back.md` lists the seven answers it was built on. Original wording: a proposal only, nothing built until the founder answers section 5 and says "go". It is the second half of step 3b of `hr-governance-plan.md` section 2.4. The first half (3b-1) only measures and tells HR; it is built and changes nothing.

## 1. Where things stand

- Built and merged: the retention schedule as data, unverified until the legal adviser has seen it, and legal holds (step 3a, #195).
- Built in 3b-1 (this branch): the due view for every category the system can work out, expiry notices (the HR digest), and hold review reminders. Read only.
- **What deletes today:** only three things, each from its own HR-policy setting: erasing a former employee (a request, a different person approves), anonymising old unsuccessful applicants (daily job), purging old raw survey answers. Each already stops under a legal hold.
- **What does not exist:** any way to remove the words of appraisals, probation, feedback, improvement plans, disciplinary, training, skills, welfare cases or succession **on their own** when their period ends. Today those go only when the whole person is erased.

## 2. What 3b-2 would add

A **retention run**: HR **proposes** a run for one category; the **Company Administrator, a different person, confirms** it; confirming carries it out in one transaction and records what was done.

1. **Per category, ANONYMISE only.** The words of the records go and the shape stays, exactly as the existing erasure does it (reusing the same field lists: the note, comment or description is cleared; the fact that a record existed, its kind, dates and outcome stay). Nine categories: appraisals, probation, feedback, improvement plans, disciplinary, training, skills, welfare cases, succession.
2. **What is in a run** is fixed when it is proposed: the records past their period under the company's own rule, minus anything a live legal hold covers, minus any person with a case or a data request still open (as erasure already refuses). Counts only are shown to both people. Confirming **checks again** (a hold placed in between, or a case re-opened, removes that item from the run and the run says how many it skipped).
3. **An unverified rule does not run** unless the Company Administrator **accepts it in writing on screen** (a reason of at least 20 characters, recorded and flagged on the run). A rule the adviser has verified runs without that step. Changing a rule clears its verification (already built), so a changed rule is unverified again.
4. **A small company is not stuck:** if the Company Administrator is also the only person who can propose, the second-person rule's single-holder exception applies (written reason, flagged), as for cases and sanctions.
5. **Audit:** category, counts, the run date, who proposed, who confirmed, the rule as it stood (period, trigger, verified or accepted unverified), never a name or any text. Each run is kept as a row so "what did we delete, when, on whose say-so" can be answered.
6. **Ledger:** a run records which person's or case's records it cleared, so the due counts do not count them again and a second run does not redo them.
7. **Migration (additive, reversible):** a run table and a small item table; no existing table changes.

**Not changed:** erasing a former employee (the employee file) keeps its own request and approval flow; raw surveys and unsuccessful applicants keep their HR-policy-driven runs. **Not built:** a hard delete of anything; deleting or touching the audit log or the access logs (they are only ever reviewed, by design).

## 3. Why it is safe to build, and what could still go wrong

- It cannot run by itself: a person proposes and a different person confirms every run.
- An unverified rule is refused unless the Company Administrator writes down why.
- A hold always wins, at proposal and again at confirmation.
- **It is irreversible once confirmed** (the words are gone; only the shape stays). The explain-back note will say: **back up the database before the first run**, and the screen will say so too.
- **Risk:** the periods are the founder's proposals and not legal advice. The safeguard is the verification gate above; the lawyer should see the defaults before any company confirms a first run.

## 4. How it will be tested (written first)

Per category: past-period records are cleared and the shape stays; records within the period, current employees' records (for the exit-based categories), another company's records and held records are untouched; a hold placed between proposal and confirmation removes the item; an open case skips the person; the proposer cannot confirm; the HR administrator cannot confirm at all; an unverified rule is refused without the written acceptance and runs with it (flagged); a changed rule is unverified again; audit carries counts and ids and no text; the ledger stops a second run redoing the same items; the migration is round-tripped on a seeded copy.

## 5. Questions for the founder (recommended answers first)

1. **Granularity: one run per category (recommended), or one run for everything due?** Per category lets the lawyer approve categories one at a time.
2. **Unverified rule: allowed only with the Company Administrator's written acceptance on screen (recommended, as in the governance plan), or never?** "Never" is safer but makes the module unusable until the lawyer has seen every default.
3. **Who proposes and who confirms: HR proposes, the Company Administrator confirms, never the same person (recommended).** With the single-holder exception for a company with only one such person.
4. **Rules that say DELETE for a category that has no deleting function (everything except raw survey answers): refuse to save such a rule (recommended)**, because the system would show "delete" but only ever anonymise or do nothing.
5. **A person with an open case or data request is skipped, not blocked (recommended)**: the run goes ahead for everyone else and reports how many it skipped.
6. **Should the very first run of any category need a preview that both people have looked at (a "dry run") before it can be confirmed?** Recommended: yes, the proposal already is the preview (counts only), and a run cannot be confirmed in the same minute it is proposed.
7. **Welfare cases and succession are counted from the case closing and the last review, so a run can touch the records of someone who still works here. Is that what you want?** Recommended: yes for welfare (your default is six years after the case closes); succession is "review" by default, so no run is offered for it unless the rule is changed to anonymise.

## 6. Suggested order

1. Founder answers section 5 and says "go". 2. Tests first. 3. Run table and ledger migration, round-tripped. 4. Per-category anonymisers, extracted from the existing erasure function without changing it (the existing erasure tests are the proof). 5. Propose, confirm and reject. 6. Screen. 7. Explain-back note, release notes, browser check, full suite.
