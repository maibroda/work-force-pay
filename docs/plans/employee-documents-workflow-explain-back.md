# Explain-back note: the document approval workflow and the checklist links (part B)

Branch `employee-documents-workflow` (builds on #160). One migration, `20261127090000_document_workflow_and_task_links` (additive columns and foreign keys only). This changes **who can approve a document, and when an onboarding or exit step counts as done**, so it needs your review. Built on your go and your answers of 2026-11-07 (a no-approval type completes its step on upload; one button links the clear standard steps).

## The rules, step by step

1. **A new upload is Pending.** A person who manages documents **submits** it (Submitted); this only works for a type that needs approval and a document that has a file.
2. **An approver takes it for review** (Under review, by them) and then **approves** or **rejects** it. A rejection **must have a reason** of at least a few words. The reviewer's name, the date and the note are stored.
3. **The person who uploaded the latest file, or who submitted the document, can never take it, approve it or reject it**, even if they hold the approve permission: the server refuses ("someone else has to review it"). If one approver has taken it, **only that approver** can decide it.
4. **Replacing the file starts over**: the document goes back to Pending and the submit and review fields are cleared, so a changed file is never covered by an old approval.
5. **A checklist step can name a document type.** A new hire's or leaver's tasks copy that link from the template. The step **follows its document**: no file or not submitted = Pending; submitted = Submitted; taken = Under review; **approved = Completed**, and the system marks the step done "Document approved (reviewer)". A rejected or archived document leaves it Pending with the reason; a replaced one **reopens** a completed step.
6. **A step linked to a document cannot be ticked by hand.** It is completed by the approved document, or waived with a reason (the existing "not applicable"). A type that needs no approval completes its step on upload ("no approval required"). Steps with no document type work exactly as before.
7. **Every step is audited by ids**, with a rejection's reason, and each completion or reopening of a task is recorded.

## A worked example

HR hires a guard. The "Offer letter signed" step is linked to the Offer letter type, so the new hire's task shows Pending. HR uploads the signed letter from the task: the step stays Pending (it is uploaded, not submitted). HR submits it: Submitted. HR cannot approve it (they uploaded and submitted it). The company administrator takes it: Under review. They approve it with a note: the document is Approved, "approved by the company administrator on 7 November", and the onboarding step **completes itself**, recorded "Document approved (Adaeze Company Admin)". Had they rejected it with "Signature is missing", the step would stay Pending showing "Rejected: Signature is missing"; HR replaces the file, resubmits, and a second review follows.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| One person uploads, submits and approves their own document | `documents-workflow.test.ts`: the uploader and the submitter are refused at take-for-review, approve and reject; a third person can decide |
| A rejection with no reason, or a bad status jump | the reason rules; approving a Pending document, an archived document, or one another reviewer holds is refused |
| An old approval covers a changed file | a replacement returns the document to Pending with the review fields cleared, and reopens a completed step |
| A step is completed without the approved document | the step stays Pending through Submitted and Under review; hand-completion of a linked step is refused; the `not applicable` waiver is not undone by a later approval |
| An approver without the right, or without sensitive access, decides | roles without `document.approve` are refused; an identification document is "not found" to a reviewer without sensitive access; another company's is not found |
| The standard-step button overrides or breaks existing data | it links only unlinked steps, never a step already linked by hand, never the broad steps, and never existing tasks |
| The migration loses data | round trip on a copy of the seeded database (2,399 onboarding tasks, 108 exit tasks, 31 documents unchanged) |

## What I did not do or test

- **Not built yet:** the central HR register (search, missing and expiring tracking, the approval queue) and the employee's own read-only view (the last pull request). Approvers currently review from each employee's Documents tab; there is no single queue yet.
- **Checked in a browser against the test database** with two different users: HR uploaded an offer letter from the onboarding step and submitted it (with no review buttons for the submitter); the company administrator took it, approved it, and the step completed itself. **Not seen in a browser:** a rejection through to a resubmission, an exit step, and the Document column and link button on the checklist settings page (the pages were loaded over HTTP and their content checked; the exit flow is covered by the integration tests).
- **Existing tasks and the broad "Documents collected" step are left as they are.** Splitting that step into ID, certificates and guarantor steps is a data change an administrator makes in the checklist editor.
- **No virus scanning**, and the encryption key must be set in the host environment (see the part A note).
