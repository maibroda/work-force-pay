# Data dictionary

Generated from `prisma/schema.prisma` by `npm run docs:dictionary`. **Do not edit by hand**: a test fails if this file is out of date with the schema. To add a description, write a `///` comment above the table or field in the schema.

166 tables and 125 sets of fixed values. Money is stored as exact decimals (`Decimal`). "Required" means the field must always have a value (a field with a default is filled in for you). Fields shown as `→ Name` link to another table.

## Tables

### Organization

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| name | String | yes |  |
| code | String | yes | (unique) |
| address | String |  |  |
| phone | String |  |  |
| email | String |  |  |
| currency | String |  | ISO 4217 currency code this organization reports and bills in. See CURRENCIES in src/lib/money.ts for the supported set and their symbol/locale. Changing this is purely a display setting for now — amounts are not converted, and most of the app still assumes NGN. |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| users | → User[] |  |  |
| numberingRules | → NumberingRule[] |  |  |
| departments | → Department[] |  |  |
| categories | → EmployeeCategory[] |  |  |
| employees | → Employee[] |  |  |
| clients | → Client[] |  |  |
| contracts | → Contract[] |  |  |
| contractRates | → ContractRate[] |  |  |
| beats | → Beat[] |  |  |
| salaryStructures | → SalaryStructure[] |  |  |
| salaryOverrides | → EmployeeSalaryOverride[] |  |  |
| payRates | → EmployeePayRate[] |  |  |
| deployments | → Deployment[] |  |  |
| movements | → StaffMovement[] |  |  |
| workRegister | → WorkRegister[] |  |  |
| payrollPeriods | → PayrollPeriod[] |  |  |
| payrollRuns | → PayrollRun[] |  |  |
| payrollRecords | → PayrollRecord[] |  |  |
| allocations | → PayrollAllocation[] |  |  |
| validationIssues | → PayrollValidationIssue[] |  |  |
| overtime | → Overtime[] |  |  |
| arrears | → Arrears[] |  |  |
| deductions | → Deduction[] |  |  |
| otherEarnings | → OtherEarning[] |  |  |
| taxRules | → TaxRule[] |  |  |
| pensionRules | → PensionRule[] |  |  |
| payrollRules | → PayrollRule[] |  |  |
| employerCostRules | → EmployerCostRule[] |  |  |
| paymentBatches | → PaymentBatch[] |  |  |
| paymentTxns | → PaymentTransaction[] |  |  |
| remittances | → StatutoryRemittance[] |  |  |
| auditLogs | → AuditLog[] |  |  |
| auditSeals | → AuditSeal[] |  |  |
| leavePolicy | → LeavePolicy |  |  |
| leaveRequests | → LeaveRequest[] |  |  |
| glAccounts | → GlAccount[] |  |  |
| glMappings | → PayrollGlMapping[] |  |  |
| journalEntries | → JournalEntry[] |  |  |
| clientInvoices | → ClientInvoice[] |  |  |
| clientReceipts | → ClientReceipt[] |  |  |
| clientInvoiceDeductions | → ClientInvoiceDeduction[] |  |  |
| employeeDocuments | → EmployeeDocument[] |  |  |
| employeeTrainings | → EmployeeTraining[] |  |  |
| disciplinaryRecords | → DisciplinaryRecord[] |  |  |
| onboardingTasks | → OnboardingTask[] |  |  |
| exitRecords | → ExitRecord[] |  |  |
| exitTasks | → ExitTask[] |  |  |
| passwordResetTokens | → PasswordResetToken[] |  |  |
| recurringDeductionRules | → RecurringDeductionRule[] |  |  |
| costCenters | → CostCenter[] |  |  |
| costCenterBudgets | → CostCenterBudget[] |  |  |
| vendors | → Vendor[] |  |  |
| purchaseOrders | → PurchaseOrder[] |  |  |
| goodsReceipts | → GoodsReceipt[] |  |  |
| isBureau | Boolean |  | A payroll bureau (ThreeRoots) serves client organizations. Each client is its own organization, so its data is isolated by construction; bureau staff are given access to the clients they work on and switch between them. |
| staffTwoFactorFrom | DateTime |  | The day two-factor sign-in becomes compulsory for every user of a bureau (any role), wherever they are working. Set when the bureau is set up and only ever brought forward, never put back. |
| bureauOrganizationId | String |  |  |
| bureauOrganization | → Organization |  |  |
| clientOrganizations | → Organization[] |  |  |
| engagementsAsBureau | → ClientEngagement[] |  |  |
| engagement | → ClientEngagement |  |  |
| staffAccessAsBureau | → StaffClientAccess[] |  |  |
| staffAccessAsClient | → StaffClientAccess[] |  |  |
| ruleReleases | → RuleRelease[] |  |  |
| clientApprovalRequired | Boolean |  | Whether a payroll needs the client's own sign-off, after the bureau's internal approval, before it can be locked. |
| clientApprovals | → PayrollClientApproval[] |  |  |
| clientQueries | → ClientQuery[] |  |  |
| clientQueryMessages | → ClientQueryMessage[] |  |  |
| clientInputBatches | → ClientInputBatch[] |  |  |
| clientInputRows | → ClientInputRow[] |  |  |
| launchChecks | → LaunchCheck[] |  |  |
| leads | → Lead[] |  |  |
| leadStageChanges | → LeadStageChange[] |  |  |
| outreachActivities | → OutreachActivity[] |  |  |
| referralPartners | → ReferralPartner[] |  |  |
| referralPayouts | → ReferralPayout[] |  |  |
| pricingSetting | → PricingSetting |  |  |
| pricingPackages | → PricingPackage[] |  |  |
| pricingAddOns | → PricingAddOn[] |  |  |
| proposals | → Proposal[] |  |  |
| healthChecks | → HealthCheck[] |  |  |
| healthCheckItems | → HealthCheckItem[] |  |  |
| healthCheckFindings | → HealthCheckFinding[] |  |  |
| calendarSetting | → PayrollCalendarSetting |  |  |
| reminderSetting | → PayrollReminderSetting |  |  |
| bankCodes | → BankCode[] |  |  |
| payslipSetting | → PayslipSetting |  |  |
| payslipDeliveries | → PayslipDelivery[] |  |  |
| paymentFileExports | → PaymentFileExport[] |  |  |
| reminderLogs | → PayrollReminderLog[] |  |  |
| calendarEntries | → PayrollCalendarEntry[] |  |  |
| inputItems | → PayrollInputItem[] |  |  |
| inputIssues | → PayrollInputIssue[] |  |  |
| rulePublications | → RulePublication[] |  |  |
| employeeImports | → EmployeeImportBatch[] |  |  |
| purchaseInvoices | → PurchaseInvoice[] |  |  |
| purchaseInvoiceDeductions | → PurchaseInvoiceDeduction[] |  |  |
| vendorPayments | → VendorPayment[] |  |  |
| fixedAssets | → FixedAsset[] |  |  |
| bankAccounts | → BankAccount[] |  |  |
| bankStatementLines | → BankStatementLine[] |  |  |
| hrPolicy | → HrPolicy |  |  |
| checklistTemplateItems | → ChecklistTemplateItem[] |  |  |
| employmentContracts | → EmploymentContract[] |  |  |
| jobRequisitions | → JobRequisition[] |  |  |
| candidates | → Candidate[] |  |  |
| interviews | → Interview[] |  |  |
| candidateChecks | → CandidateCheck[] |  |  |
| jobOffers | → JobOffer[] |  |  |
| relationsCases | → RelationsCase[] |  |  |
| relationsCaseNotes | → RelationsCaseNote[] |  |  |
| exitSettlements | → ExitSettlement[] |  |  |
| exitSettlementLines | → ExitSettlementLine[] |  |  |
| inventoryItems | → InventoryItem[] |  |  |
| stockMovements | → StockMovement[] |  |  |
| kitPacks | → KitPack[] |  |  |
| kitPackLines | → KitPackLine[] |  |  |
| staffLoans | → StaffLoan[] |  |  |
| loanInstallments | → LoanInstallment[] |  |  |
| letterTemplates | → LetterTemplate[] |  |  |
| generatedLetters | → GeneratedLetter[] |  |  |
| employeeContacts | → EmployeeContact[] |  |  |
| employeeGuarantors | → EmployeeGuarantor[] |  |  |
| trainingRequirements | → TrainingRequirement[] |  |  |
| employeeChangeRequests | → EmployeeChangeRequest[] |  |  |
| companyPolicies | → CompanyPolicy[] |  |  |
| dataAccessRequests | → DataAccessRequest[] |  |  |
| dataBreaches | → DataBreach[] |  |  |
| accountGroups | → AccountGroup[] |  |  |
| accountCategories | → AccountCategory[] |  |  |
| fiscalYears | → FiscalYear[] |  |  |
| accountingPeriods | → AccountingPeriod[] |  |  |
| fiscalYearStartMonth | Int |  | First month of the financial year (1 = January). Periods are calendar months within it. |
| employeeErasures | → EmployeeErasure[] |  |  |
| appraisalCriteria | → AppraisalCriterion[] |  |  |
| appraisalCycles | → AppraisalCycle[] |  |  |
| appraisals | → Appraisal[] |  |  |
| regions | → Region[] |  |  |
| branches | → Branch[] |  |  |
| profitCentres | → ProfitCentre[] |  |  |
| projects | → Project[] |  |  |
| journalDocuments | → JournalDocument[] |  |  |
| recurringJournals | → RecurringJournal[] |  |  |
| taxCodes | → TaxCode[] |  |  |
| serviceTypes | → ServiceType[] |  |  |
| receiptAllocations | → ReceiptAllocation[] |  |  |
| clientRefunds | → ClientRefund[] |  |  |
| clientNotes | → ClientNote[] |  |  |
| taxCertificates | → TaxCertificate[] |  |  |
| billingRules | → BillingRule[] |  |  |
| taxTransactions | → TaxTransaction[] |  |  |
| journalReversals | → JournalReversal[] |  |  |
| journalApprovalRequired | Boolean |  | Whether a manual journal needs a second person's approval before it posts. |
| invoiceApprovalRequired | Boolean |  | Whether invoices are generated as drafts that a second person approves before they post. Off: invoices post when generated. |
| closeChecklistRequired | Boolean |  | Whether every sign-off on a period's close checklist must be done before the period can be closed. |
| matchPricePct | Decimal |  | Three-way match: how far above the order's price (percent) a bill line may be before it needs a second person's approval. |
| matchQtyPct | Decimal |  | Three-way match: how far above the quantity received (percent) a bill line may be. Zero means exact. |
| billApprovalThreshold | Decimal |  | A bill with no purchase order behind it needs a second person's approval at or above this amount (zero: every such bill). |
| reconciliationRequired | Boolean |  | Whether a payroll must be reconciled to the previous one and signed off before it can be submitted for approval. |
| varianceHeadcountPct | Decimal |  | Payroll variance checks against the previous payroll: a change beyond these needs a written explanation before submission. |
| varianceEmployeePct | Decimal |  |  |
| varianceTotalPct | Decimal |  |  |
| varianceMinAmount | Decimal |  | An employee's net pay must move by at least this much (naira) to be flagged, so small amounts don't drown the real changes. |

### PayrollCalendarSetting

How a client's payroll month runs, agreed once: the dates below are worked out from it for each month.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes | (unique) |
| organization | → Organization |  |  |
| inputCutoffDay | Int |  |  |
| draftWorkingDays | Int |  |  |
| approvalWorkingDays | Int |  |  |
| payDayOfMonth | Int |  |  |
| remittanceDueDay | Int |  |  |
| expectedInputs | String[] |  | Which inputs the client is expected to send each month. |
| updatedBy | String |  |  |
| updatedAt | DateTime |  |  |

### ReferralPartner

Someone who sends the bureau business (an accountant, an HR consultant), and what they are paid when it comes.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| kind | PartnerKind |  |  |
| contactName | String |  |  |
| email | String |  |  |
| phone | String |  |  |
| commissionPct | Decimal |  | Commission is this percentage of the lead's monthly fee, for this many months, once the lead is won. |
| commissionMonths | Int |  |  |
| notes | String |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| leads | → Lead[] |  |  |
| payouts | → ReferralPayout[] |  |  |

### Lead

A prospect. Its stage changes are recorded; a won lead is final.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| number | String | yes |  |
| company | String | yes |  |
| segment | LeadSegment |  |  |
| headcount | Int |  |  |
| source | LeadSource |  |  |
| partnerId | String |  |  |
| partner | → ReferralPartner |  |  |
| contactName | String | yes |  |
| contactRole | String |  |  |
| contactEmail | String |  |  |
| contactPhone | String |  |  |
| expectedMrr | Decimal |  | What the bureau expects to bill each month if it wins this. |
| stage | LeadStage |  |  |
| stageChangedAt | DateTime |  |  |
| nextStep | String |  |  |
| nextStepOn | DateTime |  |  |
| ownerUserId | String | yes |  |
| ownerName | String | yes |  |
| lostReason | String |  |  |
| wonAt | DateTime |  |  |
| lostAt | DateTime |  |  |
| clientOrganizationId | String |  | The client organization this became, once it was onboarded. |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| stageChanges | → LeadStageChange[] |  |  |
| proposals | → Proposal[] |  |  |
| healthChecks | → HealthCheck[] |  |  |
| activities | → OutreachActivity[] |  |  |
| payouts | → ReferralPayout[] |  |  |

### LeadStageChange

Every move of a lead between stages, with who and why. Never changed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| leadId | String | yes |  |
| lead | → Lead |  |  |
| fromStage | LeadStage |  |  |
| toStage | LeadStage | yes |  |
| note | String |  |  |
| byName | String | yes |  |
| byUserId | String | yes |  |
| at | DateTime |  |  |

### OutreachActivity

One attempt to reach someone: who, how, what came of it. Qualified contacts per working day is the measure.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| leadId | String |  |  |
| lead | → Lead |  |  |
| company | String | yes |  |
| contactName | String |  |  |
| channel | OutreachChannel | yes |  |
| outcome | OutreachOutcome | yes |  |
| note | String |  |  |
| date | DateTime | yes |  |
| byName | String | yes |  |
| byUserId | String | yes |  |
| createdAt | DateTime |  |  |

### ReferralPayout

Commission actually paid to a referral partner.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| partnerId | String | yes |  |
| partner | → ReferralPartner |  |  |
| leadId | String | yes |  |
| lead | → Lead |  |  |
| amount | Decimal | yes |  |
| paidOn | DateTime | yes |  |
| reference | String |  |  |
| byName | String | yes |  |
| createdAt | DateTime |  |  |

### PricingSetting

The bureau's costs and targets: what delivering a client's payroll costs it, and the margin it aims for. Placeholders until a manager confirms them.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes | (unique) |
| organization | → Organization |  |  |
| hourlyCost | Decimal | yes | What one hour of a payroll officer's time costs the bureau. |
| softwareFixed | Decimal | yes | Software and support cost of serving one client, a fixed amount per month, plus an amount per employee. |
| softwarePerEmployee | Decimal | yes |  |
| overheadPct | Decimal | yes | Overhead loaded on top of labour and software, as a percentage. |
| targetMarginPct | Decimal | yes |  |
| vatRatePct | Decimal |  |  |
| validityDays | Int |  | How many days a proposal stays open. |
| confirmedBy | String |  |  |
| confirmedByUserId | String |  |  |
| confirmedAt | DateTime |  |  |
| updatedBy | String | yes |  |
| updatedAt | DateTime |  |  |

### PricingPackage

What a package costs the client and what delivering it takes. Scope and responsibilities are the wording that goes on a proposal.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| key | String | yes |  |
| perEmployeeRate | Decimal | yes |  |
| monthlyMinimum | Decimal | yes |  |
| onboardingFee | Decimal | yes |  |
| baseHours | Decimal | yes | Hours of a payroll officer's time each month before counting employees, and minutes more for each employee. |
| minutesPerEmployee | Decimal | yes |  |
| scope | String | yes |  |
| responsibilities | String | yes |  |
| active | Boolean |  |  |
| updatedAt | DateTime |  |  |

### PricingAddOn

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| description | String |  |  |
| monthlyFee | Decimal |  |  |
| perEmployeeFee | Decimal |  |  |
| onboardingFee | Decimal |  |  |
| hours | Decimal |  |  |
| minutesPerEmployee | Decimal |  |  |
| active | Boolean |  |  |
| updatedAt | DateTime |  |  |

### Proposal

An offer to a lead. What it says (the quote, with the rate card, scope and responsibilities as they were) is frozen when it is sent.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| leadId | String | yes |  |
| lead | → Lead |  |  |
| number | String | yes |  |
| packageKey | String | yes |  |
| headcount | Int | yes |  |
| termMonths | Int | yes |  |
| extraHours | Decimal |  | Extra delivery hours a month for what makes this client harder than the package assumes (several sites, shift allowances, ...). |
| discountPct | Decimal |  |  |
| discountReason | String |  |  |
| addOnCodes | String[] |  |  |
| quote | Json | yes | The whole quote as computed, with the wording that goes on the page. |
| monthlyFee | Decimal | yes |  |
| onboardingFee | Decimal | yes |  |
| marginPct | Decimal | yes |  |
| belowTarget | Boolean |  |  |
| status | ProposalStatus |  |  |
| approvedBy | String |  |  |
| approvedByUserId | String |  |  |
| approvedAt | DateTime |  |  |
| approvalNote | String |  |  |
| validUntil | DateTime |  |  |
| sentAt | DateTime |  |  |
| sentBy | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |
| createdBy | String | yes |  |
| createdByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### HealthCheck

A limited review of a prospect's payroll process against a standard checklist. A second person reviews it before it is issued; once issued it can't change.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| leadId | String | yes |  |
| lead | → Lead |  |  |
| number | String | yes |  |
| title | String | yes |  |
| scopeNote | String |  | What was and wasn't looked at, and how much of it, in the assessor's words. |
| periodReviewed | String |  |  |
| employeesInScope | Int |  |  |
| feeQuoted | Decimal |  | The fee agreed for the review, noted by hand (it is not priced in the proposal tool). |
| templateVersion | String | yes | The version of the checklist the items were copied from. |
| status | HealthCheckStatus |  |  |
| assessedBy | String | yes |  |
| assessedByUserId | String | yes |  |
| conductedOn | DateTime |  |  |
| submittedAt | DateTime |  |  |
| reviewedBy | String |  |  |
| reviewedByUserId | String |  |  |
| reviewedAt | DateTime |  |  |
| reviewNote | String |  |  |
| headline | String |  | A short overall observation for the summary, in the reviewer's words. |
| issuedAt | DateTime |  |  |
| withdrawnReason | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| items | → HealthCheckItem[] |  |  |
| findings | → HealthCheckFinding[] |  |  |

### HealthCheckItem

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| checkId | String | yes |  |
| check | → HealthCheck |  |  |
| code | String | yes |  |
| area | String | yes |  |
| position | Int | yes |  |
| question | String | yes |  |
| guidance | String | yes |  |
| response | ControlResponse |  |  |
| evidence | String |  | What was seen: the process evidence behind the response. |
| note | String |  |  |
| assessedAt | DateTime |  |  |

### HealthCheckFinding

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| checkId | String | yes |  |
| check | → HealthCheck |  |  |
| number | Int | yes |  |
| itemCode | String |  | The control this is about, if it is about one. |
| area | String | yes |  |
| title | String | yes |  |
| description | String | yes |  |
| severity | FindingSeverity | yes |  |
| recommendation | String | yes |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |

### JobRun

One run of a scheduled job (the reminders, the HR digest, ...), written by the job's own endpoint so the app can tell whether a scheduler is calling it.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| name | String | yes |  |
| startedAt | DateTime |  |  |
| finishedAt | DateTime |  |  |
| ok | Boolean |  |  |
| error | String |  |  |

### LaunchCheck

A launch-checklist item a bureau manager has confirmed by hand (something the app can't see for itself), with who, when and what they did.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| bureauOrganizationId | String | yes |  |
| bureau | → Organization |  |  |
| key | String | yes |  |
| note | String | yes |  |
| confirmedBy | String | yes |  |
| confirmedByUserId | String | yes |  |
| confirmedAt | DateTime |  |  |

### ClientInputBatch

A month's inputs (overtime, allowances, bonuses, deductions) sent by the client's HR contact as a file. Nothing in it reaches the payroll until the bureau accepts it. Its rows are never changed; the decision is recorded once.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| number | String | yes |  |
| fileName | String | yes |  |
| checksum | String | yes | SHA-256 of the file, so the same file is not sent twice for a month. |
| status | ClientInputStatus |  |  |
| rowCount | Int | yes |  |
| warningCount | Int |  |  |
| earningsTotal | Decimal | yes |  |
| deductionsTotal | Decimal | yes |  |
| late | Boolean |  | Sent after the month's input cut-off. |
| note | String |  |  |
| markedKinds | String[] |  | The tracker inputs this upload marked as received (put back if it is refused or withdrawn). |
| submittedBy | String | yes |  |
| submittedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |
| rows | → ClientInputRow[] |  |  |

### ClientInputRow

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| batchId | String | yes |  |
| batch | → ClientInputBatch |  |  |
| line | Int | yes |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| type | String | yes | OVERTIME, ALLOWANCE, BONUS, OTHER_EARNING, or a deduction type (DEDUCTION, PENALTY, RECOVERY, SALARY_ADVANCE). |
| description | String | yes |  |
| amount | Decimal | yes |  |
| taxable | Boolean |  |  |
| reference | String |  |  |
| note | String |  |  |
| warnings | String[] |  |  |
| appliedKind | String |  | Once accepted: what the row became (OtherEarning or Deduction) and its id. |
| appliedId | String |  |  |

### ClientQuery

A question or request from a client to the bureau, with a thread of messages. How quickly it was first answered is measured from it.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| number | String | yes |  |
| subject | String | yes |  |
| category | String | yes |  |
| status | QueryStatus |  |  |
| raisedBy | String | yes |  |
| raisedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| firstResponseAt | DateTime |  | When the bureau first replied. |
| closedAt | DateTime |  |  |
| closedBy | String |  |  |
| updatedAt | DateTime |  |  |
| messages | → ClientQueryMessage[] |  |  |

### ClientQueryMessage

One message in a query's thread. Never edited or removed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| queryId | String | yes |  |
| query | → ClientQuery |  |  |
| side | String | yes | CLIENT or BUREAU. |
| authorName | String | yes |  |
| authorUserId | String | yes |  |
| body | String | yes |  |
| createdAt | DateTime |  |  |

### PayrollClientApproval

The client's own sign-off (or refusal) of a payroll, with who and why. It names the calculation it covers: a payroll calculated again afterwards needs a fresh approval. Never changed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| calculationCount | Int | yes |  |
| decision | ClientDecision | yes |  |
| comment | String |  |  |
| byName | String | yes |  |
| byUserId | String | yes |  |
| createdAt | DateTime |  |  |

### PayslipSetting

Whether payslips may be emailed to employees from this organization. Off until someone switches it on; downloads are always available.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes | (unique) |
| organization | → Organization |  |  |
| emailEnabled | Boolean |  |  |
| updatedBy | String |  |  |
| updatedAt | DateTime |  |  |

### PayslipDelivery

Every payslip emailed: to whom, when, by whom, and a fingerprint of the PDF sent. Never changed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| recordId | String | yes |  |
| employeeId | String | yes |  |
| toEmail | String | yes |  |
| checksum | String | yes |  |
| sentBy | String | yes |  |
| sentByUserId | String | yes |  |
| sentAt | DateTime |  |  |

### BankCode

A bank and the code a bulk payment upload asks for. Starts from a standard list, corrected or extended per organization; confirm against the upload guide of the bank the client pays from.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| code | String | yes |  |
| aliases | String[] |  | Other names employees' records use for the bank. |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |

### PaymentFileExport

A bank payment file produced for a payroll run: who produced it, when, how many people and how much, who was left out, and a fingerprint of the file itself so the one uploaded to the bank can be matched to the one the app made. Never changed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| fileName | String | yes |  |
| rowCount | Int | yes |  |
| totalAmount | Decimal | yes |  |
| excluded | Json | yes | People left out because their bank details could not be used, with why. |
| checksum | String | yes |  |
| createdBy | String | yes |  |
| createdByUserId | String | yes |  |
| createdAt | DateTime |  |  |

### PayrollReminderSetting

Whether, and to whom, payroll deadline reminders are emailed for a client. Off until someone switches it on.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes | (unique) |
| organization | → Organization |  |  |
| enabled | Boolean |  |  |
| remindClient | Boolean |  | Email the client's contact (from the engagement) about inputs and approval they owe. |
| remindTeam | Boolean |  | Email the bureau team working on the client a digest of overdue and imminent deadlines. |
| leadDays | Int |  | Remind this many days before a deadline, and after it passes. |
| extraEmails | String[] |  |  |
| updatedBy | String |  |  |
| updatedAt | DateTime |  |  |

### PayrollReminderLog

Every reminder email sent: to whom, about which month, when. Also what keeps the same reminder from going out twice in a day.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| periodId | String | yes |  |
| kind | String | yes |  |
| toEmail | String | yes |  |
| subject | String | yes |  |
| day | DateTime | yes | The calendar day (UTC) it was sent on. |
| sentAt | DateTime |  |  |

### PayrollCalendarEntry

One pay month's concrete dates. Worked out from the setting, then adjustable (a public holiday, an agreed exception) with a reason.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| periodId | String | yes | (unique) |
| period | → PayrollPeriod |  |  |
| inputCutoff | DateTime | yes |  |
| draftDue | DateTime | yes |  |
| approvalDue | DateTime | yes |  |
| payDate | DateTime | yes |  |
| remittanceDue | DateTime | yes |  |
| adjusted | Boolean |  |  |
| adjustReason | String |  |  |
| adjustedBy | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### PayrollInputItem

One input the client owes for a pay month, and whether it has come.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| kind | String | yes |  |
| status | InputItemStatus |  |  |
| receivedAt | DateTime |  |  |
| markedBy | String |  |  |
| markedByUserId | String |  |  |
| note | String |  | How and from whom it arrived, or why it does not apply. |
| createdAt | DateTime |  |  |

### PayrollInputIssue

A missing or inconsistent item found in a client's inputs, kept as a log with how it was settled.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| kind | String |  |  |
| description | String | yes |  |
| status | InputIssueStatus |  |  |
| raisedBy | String | yes |  |
| raisedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| resolvedBy | String |  |  |
| resolvedAt | DateTime |  |  |
| resolution | String |  |  |

### RuleRelease

A statutory rule version held by the bureau (its master set), put forward for release to its clients. The checksum pins exactly what was proposed, verified and published: if the master rule is changed afterwards, the release no longer matches and cannot go out.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| bureauOrganizationId | String | yes |  |
| bureau | → Organization |  |  |
| kind | RuleKind | yes |  |
| ruleId | String | yes | The master rule row in the bureau's own organization. |
| label | String | yes |  |
| version | String | yes |  |
| effectiveFrom | DateTime | yes |  |
| summary | String | yes | What changed and why. |
| source | String | yes | The legal basis or source: the law, gazette, circular or notice this comes from. |
| checksum | String | yes |  |
| status | RuleReleaseStatus |  |  |
| proposedBy | String | yes |  |
| proposedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| publishedAt | DateTime |  |  |
| publishedBy | String |  |  |
| withdrawnReason | String |  |  |
| withdrawnBy | String |  |  |
| verifications | → RuleVerification[] |  |  |
| publications | → RulePublication[] |  |  |

### RuleVerification

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| releaseId | String | yes |  |
| release | → RuleRelease |  |  |
| slot | VerifierSlot | yes |  |
| verifierName | String | yes |  |
| verifierUserId | String | yes |  |
| note | String | yes | What the rate was checked against. |
| checksum | String | yes | The checksum of the rule at the moment it was verified. |
| createdAt | DateTime |  |  |

### RulePublication

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| releaseId | String | yes |  |
| release | → RuleRelease |  |  |
| clientOrganizationId | String | yes |  |
| client | → Organization |  |  |
| outcome | RulePublicationOutcome | yes |  |
| message | String |  |  |
| publishedBy | String | yes |  |
| createdAt | DateTime |  |  |

### ClientEngagement

The commercial terms and contacts for one client of the bureau. Lives with the bureau; the client organization holds the payroll data.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| bureauOrganizationId | String | yes |  |
| bureau | → Organization |  |  |
| clientOrganizationId | String | yes | (unique) |
| client | → Organization |  |  |
| package | EngagementPackage | yes |  |
| status | EngagementStatus |  |  |
| startDate | DateTime | yes |  |
| termMonths | Int | yes | 6 or 12 months. |
| perEmployeeRate | Decimal |  |  |
| monthlyMinimum | Decimal |  |  |
| onboardingFee | Decimal |  |  |
| addOns | String |  |  |
| contactName | String |  |  |
| contactEmail | String |  |  |
| contactPhone | String |  |  |
| slaTerms | String |  | Agreed turnaround and service levels, in the client's words. |
| dpaReference | String |  | Reference to the signed data-processing terms, and when they were signed. |
| dpaSignedAt | DateTime |  |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### StaffClientAccess

Which bureau staff may work in which client organization. Whoever manages the bureau can work in all of them without a grant.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| bureauOrganizationId | String | yes |  |
| bureau | → Organization |  |  |
| userId | String | yes |  |
| user | → User |  |  |
| clientOrganizationId | String | yes |  |
| client | → Organization |  |  |
| grantedBy | String | yes |  |
| grantedByUserId | String | yes |  |
| createdAt | DateTime |  |  |

### User

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| email | String | yes | (unique) |
| name | String | yes |  |
| passwordHash | String | yes |  |
| role | Role | yes |  |
| active | Boolean |  |  |
| employeeId | String |  | (unique) |
| employee | → Employee |  |  |
| supervisedBeats | → Beat[] |  |  |
| lastLoginAt | DateTime |  |  |
| failedLoginAttempts | Int |  |  |
| lockedUntil | DateTime |  |  |
| sessionVersion | Int |  |  |
| totpSecret | String |  |  |
| totpEnabled | Boolean |  |  |
| totpVerifiedAt | DateTime |  |  |
| backupCodes | String[] |  | Bcrypt-hashed one-time backup codes; a code is removed from the array once used. |
| passwordResetTokens | → PasswordResetToken[] |  |  |
| clientAccess | → StaffClientAccess[] |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### PasswordResetToken

Single-use, short-lived password reset tokens — only the bcrypt hash is stored, never the raw token.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| userId | String | yes |  |
| user | → User |  |  |
| tokenHash | String | yes | (unique) |
| expiresAt | DateTime | yes |  |
| usedAt | DateTime |  |  |
| createdAt | DateTime |  |  |

### NumberingRule

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| entity | String | yes |  |
| prefix | String | yes |  |
| separator | String |  |  |
| digits | Int |  |  |
| nextNumber | Int |  |  |
| updatedAt | DateTime |  |  |

### Department

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| employees | → Employee[] |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| requisitions | → JobRequisition[] |  |  |
| journalLines | → JournalLine[] |  |  |

### CostCenter

An independent cost-grouping dimension — assignable to departments, contracts, and beats — for grouping costs your own way (e.g. by region or business unit) independent of the client/contract structure. Feeds budgeting and cost-center reporting.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| description | String |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| departments | → Department[] |  |  |
| contracts | → Contract[] |  |  |
| beats | → Beat[] |  |  |
| budgets | → CostCenterBudget[] |  |  |
| purchaseOrders | → PurchaseOrder[] |  |  |
| purchaseInvoices | → PurchaseInvoice[] |  |  |
| fixedAssets | → FixedAsset[] |  |  |
| jobRequisitions | → JobRequisition[] |  |  |
| journalLines | → JournalLine[] |  |  |

### CostCenterBudget

A per-cost-center, per-period budget for budget-vs-actual variance reporting.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| costCenterId | String | yes |  |
| costCenter | → CostCenter |  |  |
| year | Int | yes |  |
| month | Int | yes |  |
| budgetedAmount | Decimal | yes |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### EmployeeCategory

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| description | String |  |  |
| employees | → Employee[] |  |  |
| contractRates | → ContractRate[] |  |  |
| deployments | → Deployment[] |  |  |
| workRegister | → WorkRegister[] |  |  |
| requisitions | → JobRequisition[] |  |  |
| checklistItems | → ChecklistTemplateItem[] |  |  |
| kitPacks | → KitPack[] |  |  |
| trainingRequirements | → TrainingRequirement[] |  |  |
| companyPolicies | → CompanyPolicy[] |  |  |

### EmployeeImportBatch

One bulk import of employees from a file: who, when, which file, and what happened to each row. Never changed afterwards.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| fileName | String | yes |  |
| rowCount | Int | yes |  |
| importedCount | Int | yes |  |
| skippedCount | Int | yes |  |
| warningCount | Int | yes |  |
| outcomes | Json | yes | Per row: line, outcome (IMPORTED / SKIPPED), employee number, and the errors or warnings found. |
| createdBy | String | yes |  |
| createdByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| employees | → Employee[] |  |  |

### Employee

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| importBatchId | String |  |  |
| importBatch | → EmployeeImportBatch |  |  |
| clientInputRows | → ClientInputRow[] |  |  |
| employeeNumber | String | yes |  |
| firstName | String | yes |  |
| middleName | String |  |  |
| lastName | String | yes |  |
| gender | Gender |  |  |
| dateOfBirth | DateTime |  |  |
| phone | String |  |  |
| email | String |  |  |
| address | String |  |  |
| nhfContributes | Boolean |  | Has chosen to contribute to the National Housing Fund (voluntary: 2.5% of basic pay, remitted by the end of the month). Off unless chosen. |
| nhfOptedInOn | DateTime |  | The day they chose it; cleared when they stop. |
| stateOfResidence | String |  | The state PAYE is due to (one of the 36 states or FCT, under its proper name). Copied onto each payroll record when it is calculated. |
| employmentDate | DateTime | yes |  |
| exitDate | DateTime |  |  |
| anonymizedAt | DateTime |  | Set when the personal details were removed after the retention period (the record, employee number and pay figures stay). |
| status | EmployeeStatus |  |  |
| categoryId | String | yes |  |
| category | → EmployeeCategory |  |  |
| departmentId | String |  |  |
| department | → Department |  |  |
| bankName | String |  |  |
| accountNumber | String |  |  |
| accountName | String |  |  |
| taxId | String |  |  |
| pensionPin | String |  |  |
| pfa | String |  |  |
| annualRent | Decimal |  |  |
| currentClientId | String |  |  |
| currentClient | → Client |  |  |
| currentBeatId | String |  |  |
| currentBeat | → Beat |  |  |
| reportingManagerId | String |  |  |
| reportingManager | → Employee |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| user | → User |  |  |
| deployments | → Deployment[] |  |  |
| movements | → StaffMovement[] |  |  |
| workRegister | → WorkRegister[] |  |  |
| salaryOverrides | → EmployeeSalaryOverride[] |  |  |
| payRates | → EmployeePayRate[] |  |  |
| payrollRecords | → PayrollRecord[] |  |  |
| overtime | → Overtime[] |  |  |
| arrears | → Arrears[] |  |  |
| deductions | → Deduction[] |  |  |
| otherEarnings | → OtherEarning[] |  |  |
| validationIssues | → PayrollValidationIssue[] |  |  |
| paymentTxns | → PaymentTransaction[] |  |  |
| leaveRequests | → LeaveRequest[] |  |  |
| directReports | → Employee[] |  |  |
| documents | → EmployeeDocument[] |  |  |
| trainings | → EmployeeTraining[] |  |  |
| disciplinaryRecords | → DisciplinaryRecord[] |  |  |
| onboardingTasks | → OnboardingTask[] |  |  |
| exitRecords | → ExitRecord[] |  |  |
| recurringDeductionRules | → RecurringDeductionRule[] |  |  |
| assignedFixedAssets | → FixedAsset[] |  |  |
| employmentContracts | → EmploymentContract[] |  |  |
| relationsCases | → RelationsCase[] |  |  |
| exitSettlements | → ExitSettlement[] |  |  |
| candidateRecord | → Candidate |  |  |
| managedRequisitions | → JobRequisition[] |  |  |
| stockMovements | → StockMovement[] |  |  |
| staffLoans | → StaffLoan[] |  |  |
| generatedLetters | → GeneratedLetter[] |  |  |
| contacts | → EmployeeContact[] |  |  |
| guarantors | → EmployeeGuarantor[] |  |  |
| changeRequests | → EmployeeChangeRequest[] |  |  |
| policyAcknowledgements | → PolicyAcknowledgement[] |  |  |
| dataAccessRequests | → DataAccessRequest[] |  |  |
| appraisals | → Appraisal[] |  |  |
| erasures | → EmployeeErasure[] |  |  |
| journalLines | → JournalLine[] |  |  |

### EmployeeDocument

Employee documents (ID, licenses, contracts, certificates). Metadata-only — fileReference is a filename/reference/description, matching the ClientInvoiceDeduction.supportingDocument convention (this app has no object storage configured).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| documentType | DocumentType | yes |  |
| documentNumber | String |  |  |
| issueDate | DateTime |  |  |
| expiryDate | DateTime |  |  |
| fileReference | String | yes |  |
| notes | String |  |  |
| uploadedBy | String | yes |  |
| createdAt | DateTime |  |  |

### EmployeeTraining

Training & certifications — critical for a security workforce (firearms license, first aid, tactical training). expiryDate drives compliance/expiry reports and alerts.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| courseName | String | yes |  |
| provider | String |  |  |
| certificateNumber | String |  |  |
| issueDate | DateTime | yes |  |
| expiryDate | DateTime |  |  |
| status | TrainingStatus |  |  |
| fileReference | String |  |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |

### DisciplinaryRecord

Disciplinary actions and commendations — maker/checker: raised PENDING, then approved/rejected (mirrors StaffMovement's request→approve pattern).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| type | DisciplinaryType | yes |  |
| incidentDate | DateTime | yes |  |
| description | String | yes |  |
| actionTaken | String |  |  |
| issuedBy | String | yes |  |
| status | ApprovalStatus |  |  |
| approvedBy | String |  |  |
| remarks | String |  |  |
| caseId | String |  | The employee-relations case (investigation / hearing) this sanction came out of, if any. |
| relationsCase | → RelationsCase |  |  |
| createdAt | DateTime |  |  |

### OnboardingTask

Per-employee onboarding checklist — standard tasks are seeded automatically on hire (see ONBOARDING_TASKS); HR can also add ad-hoc tasks and check them off.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| taskName | String | yes |  |
| status | ChecklistStatus |  |  |
| dueDate | DateTime |  |  |
| completedBy | String |  |  |
| completedAt | DateTime |  |  |
| notes | String |  |  |
| sortOrder | Int |  |  |
| responsibleRole | String |  | Who is expected to do it (free text — "HR", "IT", "Supervisor"), copied from the template. |
| mandatory | Boolean |  |  |
| createdAt | DateTime |  |  |

### ExitRecord

Offboarding / exit management — maker/checker like StaffMovement. Approval sets Employee.status + exitDate and auto-seeds the clearance checklist (see EXIT_CLEARANCE_TASKS).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| exitType | ExitType | yes |  |
| noticeDate | DateTime | yes |  |
| lastWorkingDate | DateTime | yes |  |
| reason | String | yes |  |
| status | ApprovalStatus |  |  |
| initiatedBy | String | yes |  |
| approvedBy | String |  |  |
| remarks | String |  |  |
| reasonCategory | ExitReasonCategory |  |  |
| noticePeriodDays | Int |  | Notice the employee owed under their contract (or the org default) — frozen at initiation so a later policy edit can't rewrite a settlement that's already being prepared. |
| summaryDismissal | Boolean |  | Gross-misconduct dismissal: no notice pay is owed by the employer. |
| eligibleForRehire | Boolean |  |  |
| exitInterviewDate | DateTime |  |  |
| exitInterviewNotes | String |  |  |
| exitInterviewBy | String |  |  |
| createdAt | DateTime |  |  |
| tasks | → ExitTask[] |  |  |
| settlement | → ExitSettlement |  |  |

### ExitTask

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| exitRecordId | String | yes |  |
| exitRecord | → ExitRecord |  |  |
| taskName | String | yes |  |
| status | ChecklistStatus |  |  |
| completedBy | String |  |  |
| completedAt | DateTime |  |  |
| notes | String |  |  |
| sortOrder | Int |  |  |
| dueDate | DateTime |  |  |
| responsibleRole | String |  |  |
| mandatory | Boolean |  |  |
| blocksSettlement | Boolean |  | When true the settlement can't be approved until this item is DONE / NOT_APPLICABLE. |
| systemKey | String |  | "FINAL_SETTLEMENT" is auto-completed by the system when the settlement is approved. |
| createdAt | DateTime |  |  |

### HrPolicy

One per organization — every number a buyer might want to change without a code change: probation/notice defaults, alert windows, offer validity, and the end-of-service rules (leave encashment, gratuity, severance, notice pay). Defaults are conservative; gratuity and severance ship OFF because they're jurisdiction-specific.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes | (unique) |
| organization | → Organization |  |  |
| defaultProbationMonths | Int |  |  |
| maxProbationMonths | Int |  |  |
| defaultNoticeDays | Int |  |  |
| retirementAge | Int |  |  |
| contractAlertDays | Int |  |  |
| probationAlertDays | Int |  |  |
| offerValidityDays | Int |  |  |
| relationsCaseSlaDays | Int |  |  |
| dailyRateDivisor | Int |  | Monthly pay ÷ this = one day's pay (30 = calendar-month convention; 26 = working days). |
| leaveEncashmentEnabled | Boolean |  |  |
| leaveEncashmentBasis | EosPayBasis |  |  |
| leaveEncashmentRespectsEligibility | Boolean |  | Only encash leave once the employee has served the leave policy's eligibility period. |
| leaveEncashmentMaxDays | Int |  |  |
| leaveEncashmentTaxable | Boolean |  |  |
| leaveEncashmentExitTypes | ExitType[] |  |  |
| gratuityEnabled | Boolean |  |  |
| gratuityBasis | EosPayBasis |  |  |
| gratuityMinYears | Int |  |  |
| gratuityDaysPerYear | Decimal |  |  |
| gratuityPartialYears | Boolean |  | Count a part-year proportionally instead of only completed years. |
| gratuityTaxable | Boolean |  |  |
| gratuityExitTypes | ExitType[] |  |  |
| severanceEnabled | Boolean |  |  |
| severanceDaysPerYear | Decimal |  |  |
| severanceTaxable | Boolean |  |  |
| noticePayEnabled | Boolean |  |  |
| noticeRecoveryEnabled | Boolean |  |  |
| noticePayTaxable | Boolean |  |  |
| auditAlertEmails | String[] |  | Extra addresses (for example an outside auditor), on top of everyone who can view the audit log, or instead of them when the next field is false. |
| auditAlertIncludeEveryone | Boolean |  |  |
| loanMaxGrossMultiple | Decimal |  |  |
| loanMaxDeductionPct | Int |  |  |
| advanceMaxGrossPct | Int |  |  |
| nextOfKinRequired | Int |  |  |
| emergencyContactsRequired | Int |  |  |
| guarantorsRequired | Int |  |  |
| guarantorCategoryIds | String[] |  | Categories that must have guarantors; empty = every category. |
| guarantorMaxPerPerson | Int |  | The most employees one person may guarantee at the same time. |
| guarantorSeparateVerifier | Boolean |  | Someone other than whoever recorded a guarantor must verify them. |
| trainingAlertDays | Int |  | Flag a certificate this many days before it expires. |
| sensitiveChangeApproval | Boolean |  | A change needs a second person's approval (otherwise anyone who can edit an employee can change it). |
| bankChangeWatchDays | Int |  | Payroll validation warns when an employee's bank account was changed within this many days (0 = off). |
| appraisalSelfAssessment | Boolean |  | Employees rate themselves before their manager does. |
| appraisalCommentAtOrBelow | Int |  | A written comment is required for a rating at or below this (0 = never)… |
| appraisalCommentAtOrAbove | Int |  | …or at or above this (0 = never). |
| appraisalMinServiceDays | Int |  | Employees with less service than this (at the period end) aren't included in a cycle. |
| probationRequiresAppraisal | Boolean |  | A probation can only be confirmed after a signed-off probation appraisal. |
| probationMinScore | Decimal |  | …scoring at least this (1–5; 0 = any score). |
| dsarResponseDays | Int |  | Days allowed to answer a request for a copy of someone's data, from the day it was received. |
| reminderEmailsEnabled | Boolean |  |  |
| reminderExtraEmails | String[] |  | Addresses that get the digest in addition to every active HR admin. |
| lastDigestAt | DateTime |  |  |
| candidateRetentionMonths | Int |  |  |
| breachNotifyHours | Int |  | Hours allowed to tell the regulator once the company is aware of a breach likely to put people at risk. |
| dpoName | String |  | Who the company has named as its data protection contact, shown on the breach pages and in the notice facts. |
| dpoEmail | String |  |  |
| dpoPhone | String |  |  |
| regulatorName | String |  | The regulator breaches are reported to, and how (portal, address, email), as the company's own procedure. |
| regulatorContact | String |  |  |
| breachRunbook | String |  | The company's own breach procedure in its own words: who assesses, who tells whom, who signs off. |
| employeeRetentionYears | Int |  | Years after leaving that records must be kept for tax and pension duties; after that they can be erased. 0 = off. |
| twoFactorRoles | Role[] |  |  |
| twoFactorEnforceFrom | DateTime |  | From this day the roles above can no longer use the app without two-factor; before it they are only reminded. |
| updatedAt | DateTime |  |  |

### ChecklistTemplateItem

A checklist step that is instantiated onto every new hire (ONBOARDING) or every approved exit (EXIT_CLEARANCE). Edited in Settings so each buyer's own process is what gets seeded.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| kind | ChecklistKind | yes |  |
| taskName | String | yes |  |
| dueOffsetDays | Int |  | Onboarding: days after the start date. Exit: days relative to the last working date (negative = before). |
| responsibleRole | String |  |  |
| mandatory | Boolean |  |  |
| blocksSettlement | Boolean |  | Exit only — see ExitTask.blocksSettlement. |
| systemKey | String |  |  |
| categoryId | String |  | Limit the step to one employee category (null = everyone). |
| category | → EmployeeCategory |  |  |
| active | Boolean |  |  |
| sortOrder | Int |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### EmploymentContract

The employee's own terms of employment (distinct from `Contract`, which is a CLIENT service contract). Renewals form a chain via previousContractId; exactly one contract per employee is ACTIVE at a time (enforced in the service).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| contractNumber | String | yes |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| type | EmploymentType | yes |  |
| status | EmploymentContractStatus |  |  |
| jobTitle | String | yes |  |
| startDate | DateTime | yes |  |
| endDate | DateTime |  |  |
| probationMonths | Int |  |  |
| probationEndDate | DateTime |  |  |
| probationOutcome | ProbationOutcome |  |  |
| probationExtensions | Int |  |  |
| noticePeriodDays | Int |  |  |
| signedDate | DateTime |  |  |
| documentReference | String |  |  |
| previousContractId | String |  |  |
| previousContract | → EmploymentContract |  |  |
| renewals | → EmploymentContract[] |  |  |
| terminatedAt | DateTime |  |  |
| terminationReason | String |  |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### JobRequisition

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| requisitionNumber | String | yes |  |
| title | String | yes |  |
| departmentId | String |  |  |
| department | → Department |  |  |
| categoryId | String | yes |  |
| category | → EmployeeCategory |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| beatId | String |  | Free reference to the beat/location being staffed — validated in the service. |
| hiringManagerId | String |  |  |
| hiringManager | → Employee |  |  |
| headcount | Int |  |  |
| employmentType | EmploymentType |  |  |
| budgetedMonthlyGross | Decimal |  |  |
| justification | String | yes |  |
| targetStartDate | DateTime |  |  |
| status | RequisitionStatus |  |  |
| requestedBy | String | yes |  |
| requestedById | String | yes |  |
| approvedBy | String |  |  |
| approvedAt | DateTime |  |  |
| decisionNote | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| candidates | → Candidate[] |  |  |

### Candidate

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| candidateNumber | String | yes |  |
| requisitionId | String | yes |  |
| requisition | → JobRequisition |  |  |
| firstName | String | yes |  |
| lastName | String | yes |  |
| phone | String |  |  |
| email | String |  |  |
| source | CandidateSource |  |  |
| stage | CandidateStage |  |  |
| expectedMonthlyGross | Decimal |  |  |
| resumeReference | String |  |  |
| notes | String |  |  |
| rejectionReason | String |  |  |
| stageChangedAt | DateTime |  |  |
| employeeId | String |  | Set once the candidate is converted into an employee. (unique) |
| employee | → Employee |  |  |
| anonymizedAt | DateTime |  | Set when the candidate's personal details were removed under the retention rule. |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| interviews | → Interview[] |  |  |
| checks | → CandidateCheck[] |  |  |
| offers | → JobOffer[] |  |  |

### Interview

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| candidateId | String | yes |  |
| candidate | → Candidate |  |  |
| round | Int |  |  |
| scheduledAt | DateTime | yes |  |
| mode | String |  |  |
| interviewer | String | yes |  |
| score | Int |  | 1–5 scorecard rating, set when feedback is recorded. |
| recommendation | InterviewRecommendation |  |  |
| feedback | String |  |  |
| completedAt | DateTime |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |

### CandidateCheck

Pre-employment vetting step (references, ID, police clearance, guarantor, medical…). A candidate can't be hired while any check is still PENDING or FAILED.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| candidateId | String | yes |  |
| candidate | → Candidate |  |  |
| checkType | CandidateCheckType | yes |  |
| status | CheckStatus |  |  |
| notes | String |  |  |
| checkedBy | String |  |  |
| checkedAt | DateTime |  |  |
| createdAt | DateTime |  |  |

### JobOffer

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| offerNumber | String | yes |  |
| candidateId | String | yes |  |
| candidate | → Candidate |  |  |
| jobTitle | String | yes |  |
| monthlyGross | Decimal | yes |  |
| employmentType | EmploymentType |  |  |
| probationMonths | Int |  |  |
| noticePeriodDays | Int |  |  |
| startDate | DateTime | yes |  |
| validUntil | DateTime | yes |  |
| setPayRate | Boolean |  | Create an effective-dated personal pay rate on hire (office staff). Guards are normally paid from the client contract's agreed rates, so this is switched off for them. |
| status | OfferStatus |  |  |
| createdBy | String | yes |  |
| createdById | String | yes |  |
| approvedBy | String |  |  |
| approvedAt | DateTime |  |  |
| sentAt | DateTime |  |  |
| respondedAt | DateTime |  |  |
| declineReason | String |  |  |
| decisionNote | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### RelationsCase

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| caseNumber | String | yes |  |
| employeeId | String | yes | The employee the case is about (the complainant for a grievance, the subject for misconduct). |
| employee | → Employee |  |  |
| type | RelationsCaseType | yes |  |
| severity | CaseSeverity |  |  |
| status | CaseStatus |  |  |
| confidential | Boolean |  | Confidential cases show only their existence (not content) to read-only HR viewers. |
| summary | String | yes |  |
| description | String | yes |  |
| raisedBy | String | yes |  |
| raisedByUserId | String | yes |  |
| selfRaised | Boolean |  |  |
| assignedTo | String |  |  |
| openedAt | DateTime |  |  |
| dueDate | DateTime |  |  |
| outcome | CaseOutcome |  |  |
| resolution | String |  |  |
| resolvedAt | DateTime |  |  |
| closedAt | DateTime |  |  |
| closedBy | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| notes | → RelationsCaseNote[] |  |  |
| disciplinaryRecords | → DisciplinaryRecord[] |  |  |

### RelationsCaseNote

Append-only case file entries — never edited or deleted, so the investigation record is intact.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| caseId | String | yes |  |
| relationsCase | → RelationsCase |  |  |
| kind | CaseNoteKind |  |  |
| note | String | yes |  |
| authorName | String | yes |  |
| authorUserId | String | yes |  |
| createdAt | DateTime |  |  |

### ExitSettlement

What an exiting employee is owed (or owes) beyond their final month's pay. Computed from the HrPolicy, reviewed and approved (preparer ≠ approver), then RELEASED into a payroll period as approved OtherEarning / Deduction rows — so PAYE, pension, payslips, payment batches and GL posting all happen in the normal payroll run (or a supplementary run for a locked period).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| settlementNumber | String | yes |  |
| exitRecordId | String | yes | (unique) |
| exitRecord | → ExitRecord |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| status | SettlementStatus |  |  |
| monthlyGross | Decimal | yes | Reference monthly pay the formulas used (snapshot) and how it was found. |
| monthlyBasic | Decimal | yes |  |
| dailyRate | Decimal | yes |  |
| payBasisSource | String | yes |  |
| serviceDays | Int | yes |  |
| serviceYears | Decimal | yes |  |
| leaveAccruedDays | Decimal |  |  |
| leaveTakenDays | Decimal |  |  |
| leavePayableDays | Decimal |  |  |
| noticeRequiredDays | Int |  |  |
| noticeServedDays | Int |  |  |
| noticeShortfallDays | Int |  |  |
| grossEarnings | Decimal |  |  |
| totalDeductions | Decimal |  |  |
| netSettlement | Decimal |  |  |
| payrollPeriodId | String |  |  |
| payrollPeriod | → PayrollPeriod |  |  |
| preparedBy | String | yes |  |
| preparedById | String | yes |  |
| computedAt | DateTime |  |  |
| submittedAt | DateTime |  |  |
| approvedBy | String |  |  |
| approvedAt | DateTime |  |  |
| releasedBy | String |  |  |
| releasedAt | DateTime |  |  |
| remarks | String |  |  |
| calcTrace | Json |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| lines | → ExitSettlementLine[] |  |  |

### ExitSettlementLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| settlementId | String | yes |  |
| settlement | → ExitSettlement |  |  |
| kind | SettlementLineKind | yes |  |
| code | String | yes | LEAVE_ENCASHMENT, GRATUITY, SEVERANCE, NOTICE_PAY, NOTICE_RECOVERY, or a manual code. |
| description | String | yes |  |
| quantity | Decimal |  |  |
| rate | Decimal |  |  |
| amount | Decimal | yes |  |
| taxable | Boolean |  |  |
| manual | Boolean |  | Manual lines (loan recovery, unreturned property, ex-gratia…) survive a recompute. |
| otherEarningId | String |  | Traceability once released: the payroll input rows this line became. |
| deductionId | String |  |  |
| loanId | String |  | Set when the line recovers the balance of a staff loan. |
| sortOrder | Int |  |  |
| createdAt | DateTime |  |  |

### Client

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| contactPerson | String |  |  |
| address | String |  |  |
| phone | String |  |  |
| email | String |  |  |
| status | ClientStatus |  |  |
| startDate | DateTime |  |  |
| endDate | DateTime |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| contracts | → Contract[] |  |  |
| beats | → Beat[] |  |  |
| employees | → Employee[] |  |  |
| deployments | → Deployment[] |  |  |
| workRegister | → WorkRegister[] |  |  |
| overtime | → Overtime[] |  |  |
| allocations | → PayrollAllocation[] |  |  |
| movementsFrom | → StaffMovement[] |  |  |
| movementsTo | → StaffMovement[] |  |  |
| invoices | → ClientInvoice[] |  |  |
| receipts | → ClientReceipt[] |  |  |
| invoiceDeductions | → ClientInvoiceDeduction[] |  |  |
| journalLines | → JournalLine[] |  |  |
| receiptRefunds | → ClientRefund[] |  |  |
| notes | → ClientNote[] |  |  |
| taxCertificates | → TaxCertificate[] |  |  |

### Contract

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| contractNumber | String | yes |  |
| name | String | yes |  |
| startDate | DateTime | yes |  |
| endDate | DateTime |  |  |
| contractValue | Decimal |  |  |
| billingMethod | BillingMethod |  |  |
| status | ContractStatus |  |  |
| operativeSharePct | Decimal |  |  |
| businessLine | BusinessLine |  |  |
| defaultStructureId | String |  |  |
| defaultStructure | → SalaryStructure |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| notes | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| rates | → ContractRate[] |  |  |
| beats | → Beat[] |  |  |
| deployments | → Deployment[] |  |  |
| workRegister | → WorkRegister[] |  |  |
| overtime | → Overtime[] |  |  |
| allocations | → PayrollAllocation[] |  |  |
| invoiceLines | → ClientInvoiceLine[] |  |  |
| movementsFrom | → StaffMovement[] |  |  |
| movementsTo | → StaffMovement[] |  |  |
| journalLines | → JournalLine[] |  |  |
| serviceTypeId | String |  | Which service this contract is billed as; its billing rule applies unless the contract has an approved override. |
| serviceType | → ServiceType |  |  |
| billingRules | → BillingRule[] |  |  |

### ContractRate

CLIENT → CONTRACT → EMPLOYEE CATEGORY → SALARY STRUCTURE → AGREED RATE (effective-dated)

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| contractId | String | yes |  |
| contract | → Contract |  |  |
| categoryId | String | yes |  |
| category | → EmployeeCategory |  |  |
| salaryStructureId | String | yes |  |
| salaryStructure | → SalaryStructure |  |  |
| agreedRate | Decimal | yes |  |
| operativeSharePct | Decimal |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| createdAt | DateTime |  |  |

### Beat

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| contractId | String | yes |  |
| contract | → Contract |  |  |
| code | String | yes |  |
| name | String | yes |  |
| bidReference | String |  |  |
| region | String |  |  |
| state | String |  |  |
| lga | String |  |  |
| address | String |  |  |
| siteContact | String |  |  |
| approvedStrength | Int |  |  |
| status | BeatStatus |  |  |
| startDate | DateTime |  |  |
| endDate | DateTime |  |  |
| supervisorId | String |  |  |
| supervisor | → User |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| currentEmployees | → Employee[] |  |  |
| deployments | → Deployment[] |  |  |
| workRegister | → WorkRegister[] |  |  |
| overtime | → Overtime[] |  |  |
| allocations | → PayrollAllocation[] |  |  |
| movementsFrom | → StaffMovement[] |  |  |
| movementsTo | → StaffMovement[] |  |  |
| invoiceLines | → ClientInvoiceLine[] |  |  |
| recurringDeductionRules | → RecurringDeductionRule[] |  |  |
| journalLines | → JournalLine[] |  |  |

### SalaryStructure

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| description | String |  |  |
| calculationMethod | StructureMethod |  |  |
| isPartial | Boolean |  |  |
| isDefault | Boolean |  |  |
| status | StructureStatus |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| components | → SalaryComponent[] |  |  |
| contractRates | → ContractRate[] |  |  |
| contracts | → Contract[] |  |  |

### SalaryComponent

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| structureId | String | yes |  |
| structure | → SalaryStructure |  |  |
| code | String | yes |  |
| name | String | yes |  |
| calcType | ComponentCalcType |  |  |
| percentage | Decimal |  |  |
| fixedAmount | Decimal |  |  |
| formula | String |  |  |
| taxable | Boolean |  |  |
| pensionable | Boolean |  |  |
| employerCost | Boolean |  |  |
| active | Boolean |  |  |
| sortOrder | Int |  |  |

### EmployeeSalaryOverride

Employee-specific component override (never overwrites the base structure)

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| componentCode | String | yes |  |
| calcType | ComponentCalcType |  |  |
| percentage | Decimal |  |  |
| fixedAmount | Decimal |  |  |
| reason | String | yes |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| approvedBy | String | yes |  |
| status | ApprovalStatus |  |  |
| createdAt | DateTime |  |  |

### EmployeePayRate

Employee-specific monthly gross (e.g. office staff / supervisors not billed per head), effective-dated

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| monthlyGross | Decimal | yes |  |
| structureCode | String |  |  |
| reason | String | yes |  |
| approvedBy | String | yes |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| createdAt | DateTime |  |  |

### Deployment

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| contractId | String | yes |  |
| contract | → Contract |  |  |
| beatId | String | yes |  |
| beat | → Beat |  |  |
| categoryId | String | yes |  |
| category | → EmployeeCategory |  |  |
| shift | Shift |  |  |
| startDate | DateTime | yes |  |
| endDate | DateTime |  |  |
| status | DeploymentStatus |  |  |
| movementId | String |  |  |
| createdAt | DateTime |  |  |

### StaffMovement

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| movementType | MovementType | yes |  |
| fromClientId | String |  |  |
| fromClient | → Client |  |  |
| fromContractId | String |  |  |
| fromContract | → Contract |  |  |
| fromBeatId | String |  |  |
| fromBeat | → Beat |  |  |
| toClientId | String | yes |  |
| toClient | → Client |  |  |
| toContractId | String | yes |  |
| toContract | → Contract |  |  |
| toBeatId | String | yes |  |
| toBeat | → Beat |  |  |
| movementDate | DateTime | yes |  |
| effectiveDate | DateTime | yes |  |
| endDate | DateTime |  |  |
| reason | String | yes |  |
| requestedBy | String | yes |  |
| approvedBy | String |  |  |
| status | ApprovalStatus |  |  |
| remarks | String |  |  |
| createdAt | DateTime |  |  |

### WorkRegister

Operational source of truth for WHERE an employee worked on each day.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| date | DateTime | yes |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| contractId | String | yes |  |
| contract | → Contract |  |  |
| beatId | String | yes |  |
| beat | → Beat |  |  |
| categoryId | String | yes |  |
| category | → EmployeeCategory |  |  |
| shift | Shift |  |  |
| attendanceStatus | AttendanceStatus | yes |  |
| hoursWorked | Decimal |  |  |
| overtimeHours | Decimal |  |  |
| supervisor | String |  |  |
| remarks | String |  |  |
| source | EntrySource |  |  |
| locationMismatch | Boolean |  |  |
| mismatchResolved | Boolean |  |  |
| resolutionNote | String |  |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### PayrollPeriod

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| year | Int | yes |  |
| month | Int | yes |  |
| startDate | DateTime | yes |  |
| endDate | DateTime | yes |  |
| status | PeriodStatus |  |  |
| approvedBy | String |  |  |
| approvedAt | DateTime |  |  |
| lockedBy | String |  |  |
| lockedAt | DateTime |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| runs | → PayrollRun[] |  |  |
| overtime | → Overtime[] |  |  |
| deductions | → Deduction[] |  |  |
| otherEarnings | → OtherEarning[] |  |  |
| arrearsOriginal | → Arrears[] |  |  |
| arrearsProcessed | → Arrears[] |  |  |
| invoices | → ClientInvoice[] |  |  |
| exitSettlements | → ExitSettlement[] |  |  |
| calendarEntry | → PayrollCalendarEntry |  |  |
| inputItems | → PayrollInputItem[] |  |  |
| inputIssues | → PayrollInputIssue[] |  |  |
| clientInputs | → ClientInputBatch[] |  |  |

### PayrollRun

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| runNumber | Int | yes |  |
| type | RunType |  |  |
| status | RunStatus |  |  |
| description | String |  |  |
| taxRuleVersion | String |  |  |
| pensionRuleVersion | String |  |  |
| employeeCount | Int |  |  |
| totalGross | Decimal |  |  |
| totalNet | Decimal |  |  |
| totalPaye | Decimal |  |  |
| totalEmployeePension | Decimal |  |  |
| totalEmployerPension | Decimal |  |  |
| totalDeductions | Decimal |  |  |
| totalOvertime | Decimal |  |  |
| totalArrears | Decimal |  |  |
| totalClientBilling | Decimal |  |  |
| totalManagementShare | Decimal |  |  |
| totalEmployerCost | Decimal |  |  |
| totalItf | Decimal |  |  |
| totalNsitf | Decimal |  |  |
| totalNhfMedical | Decimal |  |  |
| totalInsurance | Decimal |  |  |
| totalUniformKits | Decimal |  |  |
| totalRecruitmentTraining | Decimal |  |  |
| totalLeaveReliever | Decimal |  |  |
| totalOutsourcingLeaveAllowance | Decimal |  |  |
| totalEmployerAddOns | Decimal |  |  |
| calculatedBy | String |  |  |
| calculatedAt | DateTime |  |  |
| calculationCount | Int |  |  |
| preparedByUserIds | String[] |  | Everyone who has calculated this payroll. None of them, nor whoever submitted it, may approve it. |
| submittedBy | String |  |  |
| submittedByUserId | String |  |  |
| submittedAt | DateTime |  |  |
| approvedBy | String |  |  |
| approvedByUserId | String |  |  |
| approvedAt | DateTime |  |  |
| reconciledBy | String |  | Sign-off that this payroll has been reconciled to the previous one. Cleared when the payroll is recalculated. |
| reconciledByUserId | String |  |  |
| reconciledAt | DateTime |  |  |
| reconciliationNote | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| records | → PayrollRecord[] |  |  |
| allocations | → PayrollAllocation[] |  |  |
| issues | → PayrollValidationIssue[] |  |  |
| paymentBatches | → PaymentBatch[] |  |  |
| remittances | → StatutoryRemittance[] |  |  |
| journalEntry | → JournalEntry |  |  |
| invoices | → ClientInvoice[] |  |  |

### PayrollRecord

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| run | → PayrollRun |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| employeeNumber | String | yes |  |
| employeeName | String | yes |  |
| categoryName | String | yes |  |
| departmentName | String |  |  |
| bankName | String |  |  |
| accountNumber | String |  |  |
| accountName | String |  |  |
| pensionPin | String |  |  |
| pfa | String |  |  |
| taxId | String |  |  |
| payeState | String |  | Copy of the employee's state of residence when the payroll was calculated, so a locked payroll never changes if the employee moves (like pfa). |
| basisDays | Int | yes |  |
| daysWorked | Decimal | yes |  |
| daysAbsent | Int |  |  |
| suspensionDays | Int |  |  |
| overtimeHours | Decimal |  |  |
| monthlyGross | Decimal | yes |  |
| earnedGross | Decimal | yes |  |
| overtimeAmount | Decimal |  |  |
| arrearsAmount | Decimal |  |  |
| otherEarnings | Decimal |  |  |
| totalEarnings | Decimal | yes |  |
| pensionBase | Decimal | yes |  |
| employeePension | Decimal | yes |  |
| employerPension | Decimal | yes |  |
| taxableIncome | Decimal | yes |  |
| paye | Decimal | yes |  |
| otherDeductions | Decimal |  |  |
| totalDeductions | Decimal | yes |  |
| netPay | Decimal | yes |  |
| clientBilling | Decimal |  |  |
| managementShare | Decimal |  |  |
| employerCost | Decimal | yes |  |
| itfAmount | Decimal |  |  |
| nsitfAmount | Decimal |  |  |
| nhfMedicalAmount | Decimal |  |  |
| insuranceAmount | Decimal |  |  |
| uniformKitsAmount | Decimal |  |  |
| recruitmentTrainingAmount | Decimal |  |  |
| leaveRelieverAmount | Decimal |  |  |
| outsourcingLeaveAllowanceAmount | Decimal |  |  |
| totalEmployerAddOns | Decimal |  |  |
| businessLine | String |  | GUARDING / OUTSOURCING when every paid segment shares one business line, BACK_OFFICE when the employee has no contract segments at all (pay-rate only), MIXED otherwise. |
| taxRuleVersion | String | yes |  |
| hasOverride | Boolean |  |  |
| lines | Json | yes |  |
| locations | Json | yes |  |
| calcTrace | Json |  |  |
| createdAt | DateTime |  |  |
| allocations | → PayrollAllocation[] |  |  |
| paymentTxns | → PaymentTransaction[] |  |  |

### PayrollAllocation

Split of every payroll record by client / contract / beat — powers client & beat reports.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| run | → PayrollRun |  |  |
| recordId | String | yes |  |
| record | → PayrollRecord |  |  |
| employeeId | String | yes |  |
| clientId | String |  |  |
| client | → Client |  |  |
| contractId | String |  |  |
| contract | → Contract |  |  |
| beatId | String |  |  |
| beat | → Beat |  |  |
| days | Decimal | yes |  |
| grossAmount | Decimal | yes |  |
| overtimeAmount | Decimal |  |  |
| employerPension | Decimal | yes |  |
| clientBilling | Decimal | yes |  |
| managementShare | Decimal | yes |  |
| itf | Decimal |  |  |
| nsitf | Decimal |  |  |
| nhfMedical | Decimal |  |  |
| insurance | Decimal |  |  |
| uniformKits | Decimal |  |  |
| recruitmentTraining | Decimal |  |  |
| leaveReliever | Decimal |  |  |
| outsourcingLeaveAllowance | Decimal |  |  |
| businessCosts | Decimal |  | Sum of the individual costs above — ITF + NSITF + insurance + uniform&kits + recruitment/training + leave reliever + outsourcing leave allowance (+ NHF/medical if configured). |
| netAmount | Decimal |  |  |

### PayrollValidationIssue

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| run | → PayrollRun |  |  |
| employeeId | String |  |  |
| employee | → Employee |  |  |
| category | String | yes |  |
| severity | Severity | yes |  |
| code | String | yes |  |
| message | String | yes |  |
| resolved | Boolean |  |  |
| overridden | Boolean |  |  |
| overrideReason | String |  |  |
| overriddenBy | String |  |  |
| requiresExplanation | Boolean |  | Variance findings must be explained in writing before the payroll can be submitted. |
| explanation | String |  |  |
| explainedBy | String |  |  |
| explainedByUserId | String |  |  |
| explainedAt | DateTime |  |  |
| createdAt | DateTime |  |  |

### Overtime

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| contractId | String | yes |  |
| contract | → Contract |  |  |
| beatId | String | yes |  |
| beat | → Beat |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| date | DateTime | yes |  |
| hours | Decimal | yes |  |
| rate | Decimal |  |  |
| amount | Decimal | yes |  |
| approvalReference | String |  |  |
| approvedBy | String |  |  |
| source | EntrySource |  |  |
| status | ApprovalStatus |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |

### Arrears

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| originalPeriodId | String | yes |  |
| originalPeriod | → PayrollPeriod |  |  |
| arrearsType | ArrearsType | yes |  |
| originalAmount | Decimal | yes |  |
| correctedAmount | Decimal | yes |  |
| difference | Decimal | yes |  |
| grossImpact | Decimal | yes |  |
| pensionableImpact | Decimal |  |  |
| taxImpact | Decimal |  |  |
| pensionImpact | Decimal |  |  |
| netImpact | Decimal |  |  |
| reason | String | yes |  |
| supportingDocument | String |  |  |
| requestedBy | String | yes |  |
| approvedBy | String |  |  |
| status | ApprovalStatus |  |  |
| processedPeriodId | String |  |  |
| processedPeriod | → PayrollPeriod |  |  |
| processedRunId | String |  |  |
| createdAt | DateTime |  |  |

### Deduction

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| deductionType | DeductionType | yes |  |
| amount | Decimal | yes |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| reason | String | yes |  |
| authorityReference | String | yes |  |
| supportingDocument | String |  |  |
| requestedBy | String | yes |  |
| approvedBy | String |  |  |
| status | ApprovalStatus |  |  |
| createdAt | DateTime |  |  |

### RecurringDeductionRule

Recurring payroll deductions applied automatically on every REGULAR run — distinct from the one-off, per-instance-approved Deduction model above. Scope determines who it applies to: GLOBAL (every paid employee that period), LOCATION (everyone who worked any day at the given beat that period), INDIVIDUAL (one named employee). Never applied on supplementary runs, to avoid double-charging within the same period.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| code | String | yes | Short code — becomes the payslip line / GL head code (e.g. "DEV_LEVY"). |
| scope | DeductionScope | yes |  |
| beatId | String |  |  |
| beat | → Beat |  |  |
| employeeId | String |  |  |
| employee | → Employee |  |  |
| calcType | RecurringDeductionCalcType | yes |  |
| percentage | Decimal |  | % of the employee's total earnings for the period, when calcType = PERCENTAGE_OF_GROSS. |
| fixedAmount | Decimal |  |  |
| active | Boolean |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| reason | String | yes |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### OtherEarning

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| name | String | yes |  |
| amount | Decimal | yes |  |
| taxable | Boolean |  |  |
| reason | String | yes |  |
| approvedBy | String |  |  |
| status | ApprovalStatus |  |  |
| createdAt | DateTime |  |  |

### TaxRule

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| version | String | yes |  |
| legalBasis | String |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| payeDueDay | Int |  | PAYE filing dates and the late penalty are RULE DATA, set from the tax adviser's verified values and never assumed. Blank = not set. Day of the month after the pay month on which PAYE is due (1 to 28). |
| annualReturnMonth | Int |  | The annual return is due on this month and day of the year after the tax year. |
| annualReturnDay | Int |  |  |
| latePenaltyPct | Decimal |  | Percentage of unremitted PAYE charged when late (interest is not modelled). |
| bands | → TaxBand[] |  |  |
| reliefs | → TaxRelief[] |  |  |
| exemptions | → TaxExemption[] |  |  |

### TaxBand

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| taxRuleId | String | yes |  |
| taxRule | → TaxRule |  |  |
| sortOrder | Int | yes |  |
| lowerBound | Decimal | yes |  |
| upperBound | Decimal |  |  |
| rate | Decimal | yes |  |

### TaxRelief

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| taxRuleId | String | yes |  |
| taxRule | → TaxRule |  |  |
| code | String | yes |  |
| name | String | yes |  |
| type | ReliefType | yes |  |
| rate | Decimal |  |  |
| amount | Decimal |  |  |
| cap | Decimal |  |  |
| active | Boolean |  |  |

### TaxExemption

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| taxRuleId | String | yes |  |
| taxRule | → TaxRule |  |  |
| code | String | yes |  |
| description | String | yes |  |
| annualGrossCeiling | Decimal | yes |  |
| active | Boolean |  |  |

### PensionRule

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| version | String | yes |  |
| employeeRate | Decimal | yes |  |
| employerRate | Decimal | yes |  |
| pensionableCodes | String[] |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| createdAt | DateTime |  |  |

### PayrollRule

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| version | String | yes |  |
| prorationBasis | ProrationBasis |  |  |
| defaultOperativeSharePct | Decimal |  |  |
| standardHoursPerDay | Decimal |  |  |
| overtimeMultiplier | Decimal |  |  |
| maxOvertimeHoursPerMonth | Decimal |  |  |
| maxDeductionPctOfGross | Decimal |  |  |
| backOfficeChargePct | Decimal |  | Overhead allocation used in Contract Profitability — % of contract revenue charged as back-office cost. |
| requirePayeState | Boolean |  | A worker with PAYE and no state of residence is a warning (false, the default) or a CRITICAL finding that blocks approval until fixed or overridden with a reason (true). |
| nhfEmployeeRatePct | Decimal |  | The rate of the VOLUNTARY NHF (National Housing Fund) contribution, as a % of BASIC pay: 2.5 by the founder's rule (the tax adviser confirms it). It is taken only from employees who have chosen to contribute (Employee.nhfContributes), as its own deduction line, and is allowed against PAYE at the amount taken. 0 = none. |
| minTakeHomePctOfGross | Decimal |  | The take-home floor, % of gross: loan and salary-advance recoveries may not take net pay below this share of gross; the part not taken is carried forward by the loan book. 0 (the default) = no floor, as pay has always been worked. A client-specific policy, not a statutory one. |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| createdAt | DateTime |  |  |

### EmployerCostRule

Employer add-on costs beyond employer pension, specific to guarding / outsourcing contracts. ITF and NSITF-ECA are % of gross salary; the rest are % of (management fee less pension employer, ITF, NSITF and NHF/medical if configured). Uniform & Kits applies to GUARDING only; Outsourcing Leave Allowance (% of Basic) applies to OUTSOURCING only. Back-office (no-contract) pay is unaffected.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| version | String | yes |  |
| itfPct | Decimal |  |  |
| nsitfPct | Decimal |  |  |
| nhfMedicalPct | Decimal |  |  |
| insurancePct | Decimal |  |  |
| uniformKitsPct | Decimal |  |  |
| recruitmentTrainingPct | Decimal |  |  |
| leaveRelieverPct | Decimal |  |  |
| outsourcingLeaveAllowancePct | Decimal |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| createdAt | DateTime |  |  |

### PaymentBatch

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| run | → PayrollRun |  |  |
| batchNumber | String | yes |  |
| bankName | String | yes |  |
| totalAmount | Decimal | yes |  |
| count | Int | yes |  |
| status | PaymentStatus |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| transactions | → PaymentTransaction[] |  |  |

### PaymentTransaction

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| batchId | String | yes |  |
| batch | → PaymentBatch |  |  |
| recordId | String | yes |  |
| record | → PayrollRecord |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| amount | Decimal | yes |  |
| bankName | String |  |  |
| accountNumber | String |  |  |
| accountName | String |  |  |
| status | PaymentStatus |  |  |
| bankReference | String |  |  |
| reconciled | Boolean |  |  |
| reconciledAt | DateTime |  |  |

### StatutoryRemittance

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| runId | String | yes |  |
| run | → PayrollRun |  |  |
| type | RemittanceType | yes |  |
| payee | String | yes |  |
| employeeAmount | Decimal | yes |  |
| employerAmount | Decimal | yes |  |
| totalAmount | Decimal | yes |  |
| headcount | Int | yes |  |
| status | PaymentStatus |  |  |
| reference | String |  |  |
| createdAt | DateTime |  |  |

### ClientInvoice

One invoice per client per payroll run, generated from that run's client billing (payrollByClientAndBeat) — the accounts-receivable side of payroll, never edited once issued.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| runId | String | yes |  |
| run | → PayrollRun |  |  |
| periodId | String | yes |  |
| period | → PayrollPeriod |  |  |
| invoiceNumber | String | yes |  |
| invoiceDate | DateTime | yes |  |
| dueDate | DateTime | yes |  |
| subtotal | Decimal | yes |  |
| directChargePct | Decimal |  | Each line's charge-out amount is split direct/indirect (defaults 90%/10%) — see ClientInvoiceLine. VAT is charged on the indirect-charge total only, not on the full subtotal. |
| indirectChargePct | Decimal |  |  |
| totalDirectCharge | Decimal |  |  |
| totalIndirectCharge | Decimal |  |  |
| vatPct | Decimal |  |  |
| vatAmount | Decimal |  |  |
| whtPct | Decimal |  | Informational only — the client is expected to withhold this on payment and remit it to the tax authority on the vendor's behalf. Does not change totalAmount; the actual amount the client withholds is recorded as a ClientInvoiceDeduction (type WITHHOLDING_TAX) against the WHT credit note when they pay, so it stays justified and evidenced like any other deduction. |
| whtAmount | Decimal |  |  |
| totalAmount | Decimal | yes |  |
| amountPaid | Decimal |  |  |
| totalDeductions | Decimal |  | Sum of ClientInvoiceDeduction — WHT actually withheld, or any other justified/evidenced deduction (e.g. leave allowance credit) a client applies instead of paying in full. |
| status | InvoiceStatus |  |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| lines | → ClientInvoiceLine[] |  |  |
| receipts | → ClientReceipt[] |  |  |
| deductions | → ClientInvoiceDeduction[] |  |  |
| receiptAllocations | → ReceiptAllocation[] |  |  |
| totalCredits | Decimal |  | Credit notes approved against this invoice reduce what is owed on it; debit notes increase it. The invoice itself is never changed. |
| totalDebits | Decimal |  |  |
| adjustmentNotes | → ClientNote[] |  |  |
| generatedByUserId | String |  | Who generated the draft (never the person who approves it), who submitted it, who approved and posted it, and when it was sent. |
| submittedBy | String |  |  |
| submittedByUserId | String |  |  |
| submittedAt | DateTime |  |  |
| approvedBy | String |  |  |
| approvedByUserId | String |  |  |
| approvedAt | DateTime |  |  |
| rejectionNote | String |  | Why an approver sent a draft back. |
| sentAt | DateTime |  |  |
| sentBy | String |  |  |
| sentVia | String |  |  |
| taxBasis | Json |  | The billing rule, tax codes and rates each contract on this invoice was calculated with, and where each came from. |
| taxTransactions | → TaxTransaction[] |  |  |

### ClientInvoiceLine

One line per category (Guard, Supervisor, …) billed on the invoice — quantity × rate = amount. Prefixed with the contract name when a client has more than one contract on the same invoice.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| invoiceId | String | yes |  |
| invoice | → ClientInvoice |  |  |
| contractId | String |  |  |
| contract | → Contract |  |  |
| billingRuleId | String |  | The billing rule this line's split and taxes were calculated under (null: the built-in default). |
| billingRule | → BillingRule |  |  |
| categoryName | String |  |  |
| description | String | yes |  |
| headcount | Int | yes |  |
| rate | Decimal |  |  |
| days | Decimal |  | Legacy: paid-day count for a beat-based line generated before category-based invoicing. Unused (and not populated) for lines generated after; kept nullable for older invoices. |
| beatId | String |  |  |
| beat | → Beat |  |  |
| amount | Decimal | yes |  |
| directCharge | Decimal |  | amount split direct/indirect at the invoice's directChargePct/indirectChargePct — direct + indirect always sums to amount. VAT is charged on the sum of indirectCharge across all lines. |
| indirectCharge | Decimal |  |  |
| sortOrder | Int |  |  |

### ClientInvoiceDeduction

A justified, evidenced deduction a client applies instead of paying an invoice in full — withholding tax, a leave-allowance credit, or any other agreed deduction. Never deleted.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| invoiceId | String | yes |  |
| invoice | → ClientInvoice |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| type | InvoiceDeductionType | yes |  |
| amount | Decimal | yes |  |
| reason | String | yes |  |
| supportingDocument | String | yes |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |

### ClientReceipt

A payment received from a client against an invoice. Never deleted — cancel/reverse with a documented reason instead if one is recorded in error.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| invoiceId | String |  | The one invoice a single-invoice receipt settles. Null for a client receipt that is allocated across invoices (or held as an advance): its settlements are the allocations. |
| invoice | → ClientInvoice |  |  |
| receiptNumber | String |  | RCT-nnnnnn for a client receipt; null for the older single-invoice receipts. |
| whtWithheld | Decimal |  | Tax the client withheld on paying (a credit with the tax authority): not cash, but settles invoices. Must all be allocated. |
| whtReference | String |  |  |
| notes | String |  |  |
| allocations | → ReceiptAllocation[] |  |  |
| refunds | → ClientRefund[] |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| amount | Decimal | yes |  |
| receivedDate | DateTime | yes |  |
| method | String |  |  |
| reference | String |  |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |
| matchedByLines | → BankStatementLine[] |  |  |

### Vendor

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| category | VendorCategory |  |  |
| contactPerson | String |  |  |
| phone | String |  |  |
| email | String |  |  |
| address | String |  |  |
| taxId | String |  |  |
| bankName | String |  |  |
| accountNumber | String |  |  |
| accountName | String |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| invoices | → PurchaseInvoice[] |  |  |
| payments | → VendorPayment[] |  |  |
| deductions | → PurchaseInvoiceDeduction[] |  |  |
| orders | → PurchaseOrder[] |  |  |
| receipts | → GoodsReceipt[] |  |  |

### PurchaseOrder

A purchase order raised before a vendor bill exists — request, approve, then convert to a PurchaseInvoice once the bill actually arrives. Lines are fixed once submitted for approval; corrections mean cancelling and raising a new order.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| orderNumber | String | yes |  |
| vendorId | String | yes |  |
| vendor | → Vendor |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| description | String | yes |  |
| subtotal | Decimal | yes |  |
| vatPct | Decimal |  |  |
| vatAmount | Decimal |  |  |
| totalAmount | Decimal | yes |  |
| status | PurchaseOrderStatus |  |  |
| requestedBy | String | yes |  |
| requestedByUserId | String |  |  |
| requestedAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionReason | String |  |  |
| notes | String |  |  |
| updatedAt | DateTime |  |  |
| lines | → PurchaseOrderLine[] |  |  |
| convertedInvoice | → PurchaseInvoice |  |  |
| receipts | → GoodsReceipt[] |  |  |

### PurchaseOrderLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| orderId | String | yes |  |
| order | → PurchaseOrder |  |  |
| description | String | yes |  |
| quantity | Decimal |  |  |
| rate | Decimal | yes |  |
| amount | Decimal | yes |  |
| sortOrder | Int |  |  |
| receiptLines | → GoodsReceiptLine[] |  |  |
| billLines | → PurchaseInvoiceLine[] |  |  |

### GoodsReceipt

Goods or services received against an approved purchase order. A receipt is a record of fact: it is never edited, only cancelled (with a reason) if it was recorded in error. The bill is matched against what was ordered and what was actually received.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| receiptNumber | String | yes |  |
| orderId | String | yes |  |
| order | → PurchaseOrder |  |  |
| vendorId | String | yes |  |
| vendor | → Vendor |  |  |
| receivedDate | DateTime | yes |  |
| deliveryNote | String |  |  |
| notes | String |  |  |
| status | GoodsReceiptStatus |  |  |
| receivedBy | String | yes |  |
| receivedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| cancelledAt | DateTime |  |  |
| cancelledBy | String |  |  |
| cancelReason | String |  |  |
| lines | → GoodsReceiptLine[] |  |  |

### GoodsReceiptLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| receiptId | String | yes |  |
| receipt | → GoodsReceipt |  |  |
| orderLineId | String | yes |  |
| orderLine | → PurchaseOrderLine |  |  |
| quantity | Decimal | yes |  |

### PurchaseInvoice

A vendor bill. Never edited once recorded — corrections go through a deduction or a new invoice.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| vendorId | String | yes |  |
| vendor | → Vendor |  |  |
| invoiceNumber | String | yes |  |
| vendorRef | String |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| purchaseOrderId | String |  | (unique) |
| purchaseOrder | → PurchaseOrder |  |  |
| invoiceDate | DateTime | yes |  |
| dueDate | DateTime | yes |  |
| description | String | yes |  |
| subtotal | Decimal | yes |  |
| vatPct | Decimal |  |  |
| vatAmount | Decimal |  |  |
| totalAmount | Decimal | yes |  |
| amountPaid | Decimal |  |  |
| totalDeductions | Decimal |  | Sum of PurchaseInvoiceDeduction — WHT we withheld from the vendor, or any other justified, evidenced deduction (short-payment, damaged-goods credit, etc.). |
| status | PurchaseInvoiceStatus |  |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdByUserId | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| matchStatus | BillMatchStatus |  | Three-way match result. EXCEPTION blocks payment until a second person approves (then APPROVED) or the exceptions clear. |
| matchExceptions | Json |  |  |
| matchApprovedBy | String |  |  |
| matchApprovedByUserId | String |  |  |
| matchApprovedAt | DateTime |  |  |
| matchApprovalReason | String |  |  |
| lines | → PurchaseInvoiceLine[] |  |  |
| payments | → VendorPayment[] |  |  |
| deductions | → PurchaseInvoiceDeduction[] |  |  |

### PurchaseInvoiceLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| invoiceId | String | yes |  |
| invoice | → PurchaseInvoice |  |  |
| description | String | yes |  |
| quantity | Decimal |  |  |
| rate | Decimal | yes |  |
| amount | Decimal | yes |  |
| sortOrder | Int |  |  |
| orderLineId | String |  | The purchase order line this bill line is for, when the bill is against an order. |
| orderLine | → PurchaseOrderLine |  |  |

### PurchaseInvoiceDeduction

A justified, evidenced deduction WE apply instead of paying a vendor bill in full — withholding tax we're required to remit on the vendor's behalf, or any other agreed short-payment. Never deleted.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| invoiceId | String | yes |  |
| invoice | → PurchaseInvoice |  |  |
| vendorId | String | yes |  |
| vendor | → Vendor |  |  |
| type | PurchaseInvoiceDeductionType | yes |  |
| amount | Decimal | yes |  |
| reason | String | yes |  |
| supportingDocument | String | yes |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |

### VendorPayment

A payment made to a vendor against a bill. Never deleted — cancel/reverse with a documented reason instead if one is recorded in error.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| invoiceId | String | yes |  |
| invoice | → PurchaseInvoice |  |  |
| vendorId | String | yes |  |
| vendor | → Vendor |  |  |
| amount | Decimal | yes |  |
| paidDate | DateTime | yes |  |
| method | String |  |  |
| reference | String |  |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |
| matchedByLines | → BankStatementLine[] |  |  |

### FixedAsset

Company-owned capital assets — vehicles, radios, CCTV, firearms, office/IT equipment. Straight-line depreciation is computed on the fly (see fixed-assets.ts), never stored, so there's nothing to re-run when a rate or date changes. Auto-numbered `FA-######`, never deleted — dispose it instead.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| assetNumber | String | yes |  |
| name | String | yes |  |
| category | FixedAssetCategory | yes |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| serialNumber | String |  |  |
| locationDescription | String |  |  |
| assignedToEmployeeId | String |  |  |
| assignedToEmployee | → Employee |  |  |
| acquisitionDate | DateTime | yes |  |
| cost | Decimal | yes |  |
| usefulLifeMonths | Int | yes |  |
| salvageValue | Decimal |  |  |
| status | FixedAssetStatus |  |  |
| disposalDate | DateTime |  |  |
| disposalProceeds | Decimal |  |  |
| disposalReason | String |  |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| journalLines | → JournalLine[] |  |  |

### BankAccount

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| bankName | String | yes |  |
| accountNumber | String | yes |  |
| glAccountId | String |  |  |
| glAccount | → GlAccount |  |  |
| openingBalance | Decimal |  |  |
| openingDate | DateTime | yes |  |
| active | Boolean |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| statementLines | → BankStatementLine[] |  |  |

### BankStatementLine

One imported bank statement line. Positive amount = money in, negative = money out. Matched against an existing ClientReceipt/VendorPayment, or marked MANUAL (bank charges, interest, inter-account transfers) with a required note — never silently ignored.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| bankAccountId | String | yes |  |
| bankAccount | → BankAccount |  |  |
| date | DateTime | yes |  |
| description | String | yes |  |
| amount | Decimal | yes |  |
| reference | String |  |  |
| matchType | BankLineMatchType |  |  |
| matchedClientReceiptId | String |  |  |
| matchedClientReceipt | → ClientReceipt |  |  |
| matchedVendorPaymentId | String |  |  |
| matchedVendorPayment | → VendorPayment |  |  |
| matchNote | String |  |  |
| matchedBy | String |  |  |
| matchedAt | DateTime |  |  |
| createdAt | DateTime |  |  |

### AuditLog

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| userId | String |  |  |
| userName | String | yes |  |
| action | String | yes |  |
| entity | String | yes |  |
| entityId | String |  |  |
| oldValue | Json |  |  |
| newValue | Json |  |  |
| reason | String |  |  |
| metadata | Json |  |  |
| createdAt | DateTime |  |  |
| seal | → AuditSeal |  | The tamper-evidence seal (see AuditSeal); absent for a few minutes after the row is written. |

### AuditSeal

One seal per audit row (rule 5: tamper-evident): SHA-256 of the row's canonical content, chained to the previous seal of the same organization by an HMAC under AUDIT_SEAL_KEY. Append-only at the database. docs/plans/tamper-evident-audit-log.md.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| seq | Int | yes | 1, 2, 3 ... per organization; unique, so two sealers at once cannot both succeed. |
| auditLogId | String | yes | (unique) |
| auditLog | → AuditLog |  |  |
| contentHash | String | yes |  |
| prevHash | String | yes |  |
| chainHash | String | yes |  |
| sealedAt | DateTime |  |  |
| sealedLate | Boolean |  | Sealed long after the row was written (the log's history from before sealing began). |

### LeavePolicy

One policy per organization. Defaults: 10 working days a year, due after 12 months' service.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes | (unique) |
| organization | → Organization |  |  |
| annualDays | Int |  |  |
| eligibilityMonths | Int |  |  |
| workingDaysPerWeek | Int |  |  |
| updatedAt | DateTime |  |  |

### LeaveRequest

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| cycleStart | DateTime | yes |  |
| cycleEnd | DateTime | yes |  |
| startDate | DateTime | yes |  |
| endDate | DateTime | yes |  |
| workingDays | Int | yes |  |
| reason | String |  |  |
| status | LeaveStatus |  |  |
| requestedBy | String | yes |  |
| decidedBy | String |  |  |
| decidedById | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### GlAccount

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| type | GlAccountType | yes |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| categoryId | String |  | Where the account sits in the hierarchy: class → group → category → account. Null until classified. |
| category | → AccountCategory |  |  |
| parentId | String |  | A sub-account hangs under a parent account; the parent then becomes a non-posting header. |
| parent | → GlAccount |  |  |
| children | → GlAccount[] |  |  |
| postable | Boolean |  | Header accounts group others and can't be posted to. |
| description | String |  |  |
| effectiveFrom | DateTime |  | The account can only be posted to on or after / on or before these dates. |
| effectiveTo | DateTime |  |  |
| statementLine | String |  | Which financial-statement line this account reports under, overriding its category's line. |
| taxMapping | String |  | Which tax return or tax ledger this account feeds (VAT_OUTPUT, WHT_RECEIVABLE, PAYE …). |
| debitMappings | → PayrollGlMapping[] |  |  |
| creditMappings | → PayrollGlMapping[] |  |  |
| lines | → JournalLine[] |  |  |
| bankAccounts | → BankAccount[] |  |  |
| requiredDimensions | String[] |  | Dimensions every posting to this account must carry (CLIENT, CONTRACT, COST_CENTER …). Empty = none required. |
| documentLines | → JournalDocumentLine[] |  |  |
| recurringLines | → RecurringJournalLine[] |  |  |

### PayrollGlMapping

Which GL accounts a payroll head (salary component, deduction, employer cost) posts to.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| headCode | String | yes |  |
| headName | String | yes |  |
| headType | GlHeadType | yes |  |
| debitAccountId | String |  |  |
| debitAccount | → GlAccount |  |  |
| creditAccountId | String |  |  |
| creditAccount | → GlAccount |  |  |

### JournalEntry

One balanced journal per payroll run, posted automatically when the run is locked. One balanced journal entry. `runId` is set only for payroll-sourced entries (PAYROLL_LOCK / PAYROLL_CLOSE / MANUAL_POST) — everything else (AR/AP/depreciation postings) leaves it null. Postgres treats each NULL as distinct, so the unique constraint still guarantees at most one journal per payroll run without blocking any number of non-payroll entries.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| entryNumber | String | yes |  |
| runId | String |  | (unique) |
| run | → PayrollRun |  |  |
| periodId | String |  | The accounting period the posting date falls in. Set when posted; older journals are stamped once by a backfill. |
| period | → AccountingPeriod |  |  |
| sourceType | String |  | The document that produced this journal (CLIENT_INVOICE, CLIENT_RECEIPT, PAYROLL_RUN …) and its id, so a ledger line can be traced back and a document with no journal can be named. |
| sourceId | String |  |  |
| periodName | String |  |  |
| postingDate | DateTime | yes |  |
| description | String | yes |  |
| source | String | yes |  |
| totalDebit | Decimal | yes |  |
| totalCredit | Decimal | yes |  |
| postedBy | String | yes |  |
| postedAt | DateTime |  |  |
| remarks | String |  |  |
| lines | → JournalLine[] |  |  |
| reversalOfId | String |  | Set when this journal reverses another: the original, which stays untouched. At most one reversal per journal. (unique) |
| reversalOf | → JournalEntry |  |  |
| reversedBy | → JournalEntry |  |  |
| document | → JournalDocument |  |  |
| reversalRequests | → JournalReversal[] |  |  |
| closedYear | → FiscalYear |  |  |

### JournalLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| journalId | String | yes |  |
| journal | → JournalEntry |  |  |
| accountId | String | yes |  |
| account | → GlAccount |  |  |
| accountCode | String | yes |  |
| accountName | String | yes |  |
| headCode | String | yes |  |
| description | String | yes |  |
| debit | Decimal |  |  |
| credit | Decimal |  |  |
| sortOrder | Int |  |  |
| clientId | String |  | Accounting dimensions: who and what the posting is for. Set when the line is posted and never changed. |
| client | → Client |  |  |
| contractId | String |  |  |
| contract | → Contract |  |  |
| beatId | String |  |  |
| beat | → Beat |  |  |
| costCenterId | String |  |  |
| costCenter | → CostCenter |  |  |
| departmentId | String |  |  |
| department | → Department |  |  |
| employeeId | String |  |  |
| employee | → Employee |  |  |
| fixedAssetId | String |  |  |
| fixedAsset | → FixedAsset |  |  |
| regionId | String |  |  |
| region | → Region |  |  |
| branchId | String |  |  |
| branch | → Branch |  |  |
| profitCentreId | String |  |  |
| profitCentre | → ProfitCentre |  |  |
| projectId | String |  |  |
| project | → Project |  |  |

### InventoryItem

A stocked item — one row per size, so "Shirt — L" and "Shirt — XL" count separately. quantityOnHand and averageCost are kept in step with the movement ledger, which is the record of truth: every change to either is a StockMovement.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| sku | String | yes |  |
| name | String | yes |  |
| category | InventoryCategory |  |  |
| size | String |  |  |
| unit | String |  |  |
| reorderLevel | Int |  |  |
| quantityOnHand | Int |  |  |
| averageCost | Decimal |  | Weighted-average cost per unit, recalculated on every receipt. |
| active | Boolean |  |  |
| notes | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| movements | → StockMovement[] |  |  |
| packLines | → KitPackLine[] |  |  |

### StockMovement

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| itemId | String | yes |  |
| item | → InventoryItem |  |  |
| type | StockMovementType | yes |  |
| quantity | Int | yes | Units in the transaction — always positive. |
| stockDelta | Int | yes | Effect on quantityOnHand (signed). Damaged / lost returns leave stock unchanged. |
| unitCost | Decimal | yes |  |
| condition | ReturnCondition |  |  |
| employeeId | String |  |  |
| employee | → Employee |  |  |
| reference | String |  | Delivery note, invoice, stocktake or requisition reference. |
| reason | String |  |  |
| balanceAfter | Int | yes |  |
| movementDate | DateTime | yes |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |

### KitPack

A standard issue — e.g. "Guard starter kit" — so onboarding is one click instead of ten.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| description | String |  |  |
| categoryId | String |  | Suggested for one employee category (informational — any pack can be issued to anyone). |
| category | → EmployeeCategory |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| lines | → KitPackLine[] |  |  |

### KitPackLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| packId | String | yes |  |
| pack | → KitPack |  |  |
| itemId | String | yes |  |
| item | → InventoryItem |  |  |
| quantity | Int | yes |  |

### StaffLoan

Money lent to an employee, interest-free, repaid from payroll. The balance is never stored: it is worked out from the instalments (a payroll deduction counts as paid once its payroll is locked).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| loanNumber | String | yes |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| type | LoanType |  |  |
| principal | Decimal | yes |  |
| installmentCount | Int |  |  |
| installmentAmount | Decimal | yes |  |
| firstDeductionYear | Int | yes | The first payroll month a repayment is taken in. |
| firstDeductionMonth | Int | yes |  |
| reason | String | yes |  |
| status | LoanStatus |  |  |
| requestedBy | String | yes |  |
| requestedById | String | yes |  |
| approvedBy | String |  |  |
| approvedAt | DateTime |  |  |
| decisionNote | String |  |  |
| disbursedOn | DateTime |  |  |
| writtenOffAmount | Decimal |  |  |
| writtenOffReason | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| installments | → LoanInstallment[] |  |  |

### LoanInstallment

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| loanId | String | yes |  |
| loan | → StaffLoan |  |  |
| kind | LoanInstallmentKind | yes |  |
| amount | Decimal | yes |  |
| deductionId | String |  | The payroll Deduction this instalment became (PAYROLL / SETTLEMENT kinds). (unique) |
| periodId | String |  |  |
| paidOn | DateTime |  |  |
| reference | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |

### LetterTemplate

The wording of one kind of letter, per organization. The body is plain text with {{field}} merge placeholders; saving rejects any placeholder the letter type doesn't offer.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| type | LetterType | yes |  |
| subject | String | yes |  |
| body | String | yes |  |
| signatoryName | String |  |  |
| signatoryTitle | String |  |  |
| updatedBy | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### GeneratedLetter

A letter as it was issued — the merged text is stored, so changing the template later never rewrites a letter already given to someone.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| referenceNumber | String | yes |  |
| type | LetterType | yes |  |
| recipientName | String | yes | Who it is about (the employee, or the candidate for an offer). |
| employeeId | String |  |  |
| employee | → Employee |  |  |
| candidateId | String |  |  |
| sourceId | String |  | The record it was generated from (offer, exit, disciplinary record…), for traceability. |
| subject | String | yes |  |
| body | String | yes |  |
| signatoryName | String |  |  |
| signatoryTitle | String |  |  |
| generatedBy | String | yes |  |
| createdAt | DateTime |  |  |

### EmployeeContact

A person connected to an employee: next of kin, emergency contact, dependant or referee. Employees can maintain their own (self-service); HR can maintain anyone's.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| kind | ContactKind | yes |  |
| fullName | String | yes |  |
| relationship | String | yes |  |
| phone | String |  |  |
| altPhone | String |  |  |
| email | String |  |  |
| address | String |  |  |
| dateOfBirth | DateTime |  |  |
| occupation | String |  |  |
| isPrimary | Boolean |  | The main next of kin / emergency contact (one per employee per kind). |
| isBeneficiary | Boolean |  | Receives death-in-service / group-life / final-pay benefits. |
| benefitSharePct | Int |  | Percentage of the benefit; an employee's shares total 100 when complete. |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### EmployeeGuarantor

A guarantor vouching for an employee (common for security and cash-handling staff). Recorded as PENDING, then verified (identity checked, signed form on file) or rejected; released when no longer needed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| fullName | String | yes |  |
| relationship | String | yes |  |
| phone | String | yes |  |
| altPhone | String |  |  |
| email | String |  |  |
| address | String | yes |  |
| occupation | String |  |  |
| employer | String |  |  |
| employerAddress | String |  |  |
| idType | String |  |  |
| idNumber | String |  |  |
| yearsKnown | Int |  |  |
| guaranteeAmount | Decimal |  | The most the guarantor accepts liability for, if the agreement caps it. |
| formReference | String |  | Reference to the signed guarantee form (filename / file number) — matching EmployeeDocument. |
| status | GuarantorStatus |  |  |
| recordedBy | String | yes |  |
| recordedByUserId | String | yes |  |
| verifiedBy | String |  |  |
| verifiedByUserId | String |  |  |
| verifiedAt | DateTime |  |  |
| verificationNote | String |  |  |
| releasedAt | DateTime |  |  |
| releaseReason | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |

### TrainingRequirement

A course or certification employees must hold — for everyone, or for one category. Matched by name (case-insensitively) against the certificates recorded on each employee (EmployeeTraining).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| courseName | String | yes |  |
| description | String |  |  |
| categoryId | String |  | Null = every employee; otherwise only this category. |
| category | → EmployeeCategory |  |  |
| graceDays | Int |  | A new joiner has this many days from their employment date before a missing certificate counts. |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |

### AppraisalCriterion

One thing employees are rated on, with its weight. Edited in Settings; a cycle snapshots the active criteria when it is launched, so later edits never change an appraisal already under way.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| description | String |  |  |
| weight | Int |  |  |
| active | Boolean |  |  |
| sortOrder | Int |  |  |
| createdAt | DateTime |  |  |
| ratings | → AppraisalRating[] |  |  |

### AppraisalCycle

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| kind | AppraisalKind |  |  |
| periodStart | DateTime | yes |  |
| periodEnd | DateTime | yes |  |
| dueDate | DateTime | yes | Reviews should be submitted by this date. |
| status | AppraisalCycleStatus |  |  |
| createdBy | String | yes |  |
| closedAt | DateTime |  |  |
| createdAt | DateTime |  |  |
| appraisals | → Appraisal[] |  |  |

### Appraisal

One employee's review in a cycle: self-assessment, then the reviewer's ratings, then sign-off by someone other than the reviewer, then the employee acknowledges (or disputes) the result.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| cycleId | String | yes |  |
| cycle | → AppraisalCycle |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| reviewerUserId | String |  |  |
| reviewerName | String |  |  |
| status | AppraisalStatus |  |  |
| selfSubmittedAt | DateTime |  |  |
| employeeSelfComment | String |  |  |
| overallScore | Decimal |  | Weighted average of the reviewer's ratings (1–5), fixed when the review is submitted. |
| overallBand | String |  |  |
| strengths | String |  |  |
| improvements | String |  |  |
| goals | String |  |  |
| reviewerComment | String |  |  |
| recommendation | AppraisalRecommendation |  |  |
| submittedAt | DateTime |  |  |
| returnNote | String |  |  |
| approvedBy | String |  |  |
| approvedByUserId | String |  |  |
| approvedAt | DateTime |  |  |
| approvalNote | String |  |  |
| acknowledgedAt | DateTime |  |  |
| employeeAgreed | Boolean |  |  |
| employeeResponse | String |  |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| ratings | → AppraisalRating[] |  |  |

### AppraisalRating

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| appraisalId | String | yes |  |
| appraisal | → Appraisal |  |  |
| criterionId | String | yes |  |
| criterion | → AppraisalCriterion |  |  |
| criterionName | String | yes | Snapshots, so renaming or re-weighting a criterion doesn't rewrite a review in progress. |
| weight | Int | yes |  |
| sortOrder | Int |  |  |
| selfRating | Int |  |  |
| selfComment | String |  |  |
| rating | Int |  |  |
| comment | String |  |  |

### EmployeeChangeRequest

A requested change to an employee's bank, tax or pension details. It takes effect only when someone other than the requester approves it; the details at request time are kept beside what was asked for.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| kind | ChangeKind | yes |  |
| proposed | Json | yes | The new values, e.g. { bankName, accountNumber, accountName }. |
| previous | Json | yes | What the employee had when the request was made. |
| reason | String | yes |  |
| status | ChangeStatus |  |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |
| appliedAt | DateTime |  | When an approved change was written to the employee record. |

### CompanyPolicy

A company policy (code of conduct, data protection, safety…) that employees must read and acknowledge — everyone, or one category. The wording lives in its versions, which are never edited once published.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| title | String | yes |  |
| summary | String |  |  |
| categoryId | String |  | Null = every employee; otherwise only this category. |
| category | → EmployeeCategory |  |  |
| graceDays | Int |  | Days an employee has to acknowledge, from the version taking effect or from joining (whichever is later). |
| status | PolicyStatus |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| versions | → PolicyVersion[] |  |  |

### PolicyVersion

One published wording of a policy. A new version means everyone has to acknowledge again.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| policyId | String | yes |  |
| policy | → CompanyPolicy |  |  |
| version | Int | yes |  |
| effectiveDate | DateTime | yes | From this date the version is the current one; a future date schedules it. |
| body | String |  | The text employees read. A document reference may be given instead, or as well. |
| documentReference | String |  | Reference to the signed-off document (file name / number) — this app has no object storage. |
| changeSummary | String |  |  |
| publishedBy | String | yes |  |
| publishedAt | DateTime |  |  |
| acknowledgements | → PolicyAcknowledgement[] |  |  |

### PolicyAcknowledgement

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| versionId | String | yes |  |
| version | → PolicyVersion |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| acknowledgedAt | DateTime |  |  |
| method | AckMethod |  |  |
| recordedBy | String |  | For a paper sign-off recorded by HR: who recorded it. |
| note | String |  |  |

### DataAccessRequest

A request from an employee (or former employee) for a copy of the personal data held on them, with the deadline to answer it. The export itself is generated on demand and never stored; the register keeps who asked, when, how identity was checked, who answered, and a checksum and section counts of what was handed over.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| requestNumber | String | yes |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| requesterName | String | yes | Who made the request — the employee, or someone acting for them. |
| channel | String |  | How it arrived: email, letter, in person… |
| receivedOn | DateTime | yes |  |
| dueOn | DateTime | yes |  |
| status | DataRequestStatus |  |  |
| identityVerified | Boolean |  |  |
| identityNote | String |  |  |
| verifiedBy | String |  |  |
| exportedAt | DateTime |  |  |
| exportChecksum | String |  | SHA-256 of the file generated, and how many records each section held. |
| exportSections | Json |  |  |
| handledBy | String |  |  |
| completedOn | DateTime |  |  |
| completionNote | String |  |  |
| refusalReason | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |

### DataBreach

A personal-data breach: what happened, when it was discovered, the assessment of risk, whether and when the regulator and the people affected were told, and how it was contained and closed. The regulator must be told within a set number of hours of the company becoming aware (HR policy: breachNotifyHours) when the breach is likely to put people at risk.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| incidentNumber | String | yes |  |
| title | String | yes |  |
| description | String | yes |  |
| discoveredAt | DateTime | yes | When the company became aware — the notification deadline counts from here. |
| occurredOn | DateTime |  |  |
| dataCategories | String[] |  | Kinds of data involved (identity, bank details, ...). |
| individualsAffected | Int |  |  |
| status | BreachStatus |  |  |
| assessment | BreachAssessment |  |  |
| assessmentNote | String |  |  |
| assessedBy | String |  |  |
| assessedAt | DateTime |  |  |
| containedAt | DateTime |  |  |
| containmentNote | String |  |  |
| rootCause | String |  |  |
| remediation | String |  |  |
| ndpcNotifiedAt | DateTime |  |  |
| ndpcReference | String |  |  |
| lateReason | String |  | Why the regulator was told after the deadline. |
| individualsNotifiedAt | DateTime |  |  |
| individualsNote | String |  |  |
| closedAt | DateTime |  |  |
| closedBy | String |  |  |
| reportedBy | String | yes |  |
| createdAt | DateTime |  |  |
| updates | → DataBreachUpdate[] |  |  |

### DataBreachUpdate

Append-only timeline of a breach: every decision and every note, with who and when.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| breachId | String | yes |  |
| breach | → DataBreach |  |  |
| note | String | yes |  |
| author | String | yes |  |
| createdAt | DateTime |  |  |

### EmployeeErasure

A request to remove a former employee's personal details once the retention period has passed. One person asks, a different person approves; approving carries it out. What was removed is recorded as counts, never as the data.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| employeeId | String | yes |  |
| employee | → Employee |  |  |
| kind | ErasureKind | yes |  |
| reason | String | yes |  |
| status | ErasureStatus |  |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decisionNote | String |  |  |
| decidedAt | DateTime |  |  |
| summary | Json |  | How many records of each kind were changed or removed. |
| createdAt | DateTime |  |  |

### FiscalYear

A financial year: twelve monthly accounting periods starting in the organization's first fiscal month.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| startDate | DateTime | yes |  |
| endDate | DateTime | yes |  |
| createdAt | DateTime |  |  |
| periods | → AccountingPeriod[] |  |  |
| closedAt | DateTime |  | Set when the year-end closing entries have been posted: the profit or loss moved to retained earnings and every income and expense account brought to nil. While it is set, nothing more can be posted to income or expense accounts dated in the year. |
| closedBy | String |  |  |
| closedByUserId | String |  |  |
| closingJournalId | String |  | (unique) |
| closingJournal | → JournalEntry |  |  |
| retainedEarningsAccountId | String |  | The equity account the year's profit or loss was moved to. |

### AccountingPeriod

One month of a financial year. Every journal belongs to one; its status decides whether it can be posted to.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| fiscalYearId | String | yes |  |
| fiscalYear | → FiscalYear |  |  |
| number | Int | yes |  |
| name | String | yes |  |
| startDate | DateTime | yes |  |
| endDate | DateTime | yes |  |
| status | AccountingPeriodStatus |  |  |
| createdAt | DateTime |  |  |
| journals | → JournalEntry[] |  |  |
| events | → AccountingPeriodEvent[] |  |  |
| snapshots | → PeriodSnapshot[] |  |  |
| checklist | → CloseChecklistItem[] |  |  |
| waivers | → CloseWaiver[] |  |  |

### PeriodSnapshot

The books of a period as they stood when it was closed: trial balance, receivables by client and invoice with ageing, payables by vendor, cash and tax balances. This is the official record: it does not change when later activity posts, and a period that is reopened and closed again gets a new version while the old one is kept, marked superseded.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| periodId | String | yes |  |
| period | → AccountingPeriod |  |  |
| version | Int | yes |  |
| asAt | DateTime | yes | The date the figures are as at: the last day of the period. |
| takenAt | DateTime |  |  |
| takenBy | String | yes |  |
| takenByUserId | String | yes |  |
| data | Json | yes |  |
| arTotal | Decimal | yes |  |
| arLedger | Decimal | yes |  |
| apTotal | Decimal | yes |  |
| apLedger | Decimal | yes |  |
| trialDebit | Decimal | yes |  |
| trialCredit | Decimal | yes |  |
| checksum | String | yes | SHA-256 of the data, so a snapshot can be proved unaltered. |
| supersededAt | DateTime |  |  |
| supersededBy | String |  |  |

### CloseChecklistItem

A sign-off on the close of a period (bank accounts reconciled, accruals reviewed …). Done by a person, with a note.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| periodId | String | yes |  |
| period | → AccountingPeriod |  |  |
| code | String | yes |  |
| label | String | yes |  |
| sortOrder | Int |  |  |
| done | Boolean |  |  |
| doneBy | String |  |  |
| doneByUserId | String |  |  |
| doneAt | DateTime |  |  |
| note | String |  |  |

### CloseWaiver

A pending item on the close checklist that an approver chose to close the period over, with the reason. Append-only.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| periodId | String | yes |  |
| period | → AccountingPeriod |  |  |
| checkCode | String | yes |  |
| reason | String | yes |  |
| waivedBy | String | yes |  |
| waivedByUserId | String | yes |  |
| createdAt | DateTime |  |  |

### AccountingPeriodEvent

Append-only trail of everything done to a period: who closed, approved, locked or reopened it, and why.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| periodId | String | yes |  |
| period | → AccountingPeriod |  |  |
| action | String | yes |  |
| fromStatus | AccountingPeriodStatus | yes |  |
| toStatus | AccountingPeriodStatus | yes |  |
| actor | String | yes |  |
| actorUserId | String | yes |  |
| reason | String |  |  |
| createdAt | DateTime |  |  |

### AccountGroup

A group of accounts within one of the seven account classes (1 Assets … 7 Finance and other).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| classNumber | Int | yes | 1 Assets, 2 Liabilities, 3 Equity, 4 Revenue, 5 Cost of services, 6 Operating expenses, 7 Finance and other. |
| code | String | yes |  |
| name | String | yes |  |
| sortOrder | Int |  |  |
| createdAt | DateTime |  |  |
| categories | → AccountCategory[] |  |  |

### AccountCategory

A category within a group. Carries the financial-statement line its accounts report under.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| groupId | String | yes |  |
| group | → AccountGroup |  |  |
| code | String | yes |  |
| name | String | yes |  |
| statementLine | String |  | The statement line accounts in this category report under (e.g. TRADE_RECEIVABLES), unless an account overrides it. |
| sortOrder | Int |  |  |
| createdAt | DateTime |  |  |
| accounts | → GlAccount[] |  |  |

### Region

A region of the business (a state, a zone, a territory). A region can sit inside a larger one, so a zone is a region of regions.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| parentId | String |  |  |
| parent | → Region |  |  |
| children | → Region[] |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| branches | → Branch[] |  |  |
| journalLines | → JournalLine[] |  |  |

### Branch

A branch or office, optionally within a region.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| regionId | String |  |  |
| region | → Region |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| journalLines | → JournalLine[] |  |  |

### ProfitCentre

A part of the business whose profit is judged separately (a division, a service line).

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| journalLines | → JournalLine[] |  |  |

### Project

A project or job that income and cost can be charged to, optionally for one client or contract.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| clientId | String |  |  |
| contractId | String |  |  |
| startDate | DateTime |  |  |
| endDate | DateTime |  |  |
| active | Boolean |  |  |
| createdAt | DateTime |  |  |
| journalLines | → JournalLine[] |  |  |

### JournalDocument

A manual journal as a document: drafted, submitted, approved by someone else, then posted through the posting engine. Only a posted document has a journal; until then nothing touches the ledger. Once submitted its lines can no longer be changed (the database enforces it) until it is rejected back to draft.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| documentNumber | String | yes |  |
| kind | JournalDocumentKind |  |  |
| description | String | yes |  |
| postingDate | DateTime | yes |  |
| reverseOn | DateTime |  | For an accrual: the date its automatic reversal is posted. |
| status | JournalDocumentStatus |  |  |
| createdBy | String | yes |  |
| createdByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| updatedAt | DateTime |  |  |
| submittedBy | String |  |  |
| submittedByUserId | String |  |  |
| submittedAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |
| postedBy | String |  |  |
| postedAt | DateTime |  |  |
| journalId | String |  | (unique) |
| journal | → JournalEntry |  |  |
| lines | → JournalDocumentLine[] |  |  |
| recurringJournalId | String |  | The recurring template that generated this draft, if any. One document per template per posting date. |
| recurringJournal | → RecurringJournal |  |  |

### JournalDocumentLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| documentId | String | yes |  |
| document | → JournalDocument |  |  |
| accountId | String | yes |  |
| account | → GlAccount |  |  |
| description | String | yes |  |
| debit | Decimal |  |  |
| credit | Decimal |  |  |
| sortOrder | Int |  |  |
| dimensions | Json |  | Dimension ids by column name (clientId, contractId, costCenterId …), checked by the posting engine when it posts. |

### RecurringJournal

A template that generates a journal draft each period (rent, insurance, amortisation, standing accruals). The draft goes through the ordinary submit / approve / post path; the template itself never touches the ledger.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| name | String | yes |  |
| kind | JournalDocumentKind |  |  |
| description | String | yes | May contain {month}, {quarter} and {year}, filled in with the posting date of each generated journal. |
| frequency | RecurrenceFrequency |  |  |
| monthEnd | Boolean |  | Post on the last day of the month instead of the first date's day of the month. |
| startDate | DateTime | yes |  |
| endDate | DateTime |  |  |
| nextRunDate | DateTime |  | The posting date of the next journal to generate; null once the template has run to its end date. |
| generatedCount | Int |  |  |
| reverseAfterDays | Int |  | For an accrual: days after its posting date that it reverses on. |
| autoSubmit | Boolean |  | Submit each generated draft for approval straight away (only when the organization requires approval). |
| active | Boolean |  |  |
| createdBy | String | yes |  |
| createdByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| updatedBy | String | yes | Whoever last changed the template: the preparer of every journal it generates after that. |
| updatedByUserId | String | yes |  |
| updatedAt | DateTime |  |  |
| lastRunAt | DateTime |  |  |
| lastRunNote | String |  |  |
| lines | → RecurringJournalLine[] |  |  |
| documents | → JournalDocument[] |  |  |

### RecurringJournalLine

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| templateId | String | yes |  |
| template | → RecurringJournal |  |  |
| accountId | String | yes |  |
| account | → GlAccount |  |  |
| description | String | yes |  |
| debit | Decimal |  |  |
| credit | Decimal |  |  |
| sortOrder | Int |  |  |
| dimensions | Json |  |  |

### ReceiptAllocation

What a tax is charged on, of a charge-out amount that is split into a direct and an indirect charge. Part of a client receipt applied to one invoice: cash, and tax the client withheld. Never edited or deleted; if it was applied to the wrong invoice it is reversed, with a reason, and the amount goes back to the receipt to be applied again.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| receiptId | String | yes |  |
| receipt | → ClientReceipt |  |  |
| invoiceId | String | yes |  |
| invoice | → ClientInvoice |  |  |
| cashAmount | Decimal | yes |  |
| whtAmount | Decimal |  |  |
| appliedOn | DateTime | yes | The date it takes effect (the receipt date, or the day an advance was applied). |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| reversedAt | DateTime |  |  |
| reversedOn | DateTime |  |  |
| reversedBy | String |  |  |
| reversalReason | String |  |  |

### TaxCertificate

A withholding tax credit note or certificate received from a client: the evidence that tax was withheld on what they paid, which is what the tax authority credits. Never edited or deleted: a wrong one is voided, with a reason, and entered again.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| certificateNumber | String | yes | As printed on the certificate. |
| numberKey | String | yes | The number with spaces and punctuation removed and upper-cased, which is what receipts and deductions are matched on. |
| issueDate | DateTime | yes |  |
| receivedDate | DateTime | yes |  |
| amount | Decimal | yes |  |
| document | String |  | Where the original is kept (a file reference, a folder, a scan name). |
| notes | String |  |  |
| recordedBy | String | yes |  |
| createdAt | DateTime |  |  |
| voidedAt | DateTime |  |  |
| voidedBy | String |  |  |
| voidReason | String |  |  |

### ClientNote

A credit note (reduces what a client owes on an invoice) or a debit note (increases it), raised by one person and approved by another. Approving posts it to the ledger and moves the invoice's balance; the invoice itself is never edited. Once decided a note is never changed: a mistaken credit note is put right with a debit note, and the other way round.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| noteNumber | String | yes |  |
| type | ClientNoteType | yes |  |
| invoiceId | String | yes |  |
| invoice | → ClientInvoice |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| noteDate | DateTime | yes |  |
| reasonCode | ClientNoteReason | yes |  |
| reason | String | yes |  |
| netAmount | Decimal | yes |  |
| vatAmount | Decimal |  |  |
| totalAmount | Decimal | yes |  |
| status | NoteStatus |  |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |

### ClientRefund

Money returned to a client out of an advance. Asked for by one person and approved by another; approving it posts the payment.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| refundNumber | String | yes |  |
| receiptId | String | yes |  |
| receipt | → ClientReceipt |  |  |
| clientId | String | yes |  |
| client | → Client |  |  |
| amount | Decimal | yes |  |
| refundDate | DateTime | yes |  |
| method | String |  |  |
| reference | String |  |  |
| reason | String | yes |  |
| status | RefundStatus |  |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |

### ServiceType

A kind of service the organization bills (Security & Guarding, Consulting …). Its billing rule is the default for every contract of the type.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| active | Boolean |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| contracts | → Contract[] |  |  |
| rules | → BillingRule[] |  |  |

### BillingRule

How a service type, or one contract, is billed from a date: the direct/indirect split and what VAT and withholding are charged on. A rule is proposed by one person and approved by another and is never edited afterwards (a change is a new rule from a later date). A contract's own rule is an override of its service type's. Exactly one of serviceTypeId and contractId is set.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| serviceTypeId | String |  |  |
| serviceType | → ServiceType |  |  |
| contractId | String |  |  |
| contract | → Contract |  |  |
| directPct | Decimal | yes |  |
| indirectPct | Decimal | yes |  |
| vatBase | BillingBase |  |  |
| whtBase | BillingBase |  |  |
| vatTaxCodeId | String |  | A particular tax code for this service or contract; blank = the organization's default code for the type. |
| whtTaxCodeId | String |  |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  |  |
| status | BillingRuleStatus |  |  |
| reason | String | yes |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |
| lines | → ClientInvoiceLine[] |  |  |

### TaxCode

A tax the organization charges or is charged (VAT, withholding tax). The rate lives in TaxRate, by date.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| code | String | yes |  |
| name | String | yes |  |
| type | TaxType | yes |  |
| accountCode | String |  | The ledger account the tax is booked to (output VAT payable, WHT receivable). |
| isDefault | Boolean |  | The code invoices use when nothing more specific applies. At most one per type. |
| active | Boolean |  |  |
| notes | String |  |  |
| createdBy | String | yes |  |
| createdAt | DateTime |  |  |
| rates | → TaxRate[] |  |  |
| transactions | → TaxTransaction[] |  |  |

### TaxRate

One rate of a tax code from a date. Rates are only ever added: a change is a new rate from a later date, proposed by one person and approved by another; the database refuses to edit or delete an approved one.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| taxCodeId | String | yes |  |
| taxCode | → TaxCode |  |  |
| ratePct | Decimal | yes |  |
| effectiveFrom | DateTime | yes |  |
| effectiveTo | DateTime |  | Set when a later rate is approved: the day before it starts. |
| status | TaxRateStatus |  |  |
| reason | String | yes |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |

### TaxTransaction

One taxed amount on a posted document: what the VAT and withholding reports read. Written with the invoice, in the same transaction, and only ever marked reversed.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| taxCodeId | String |  | Null for amounts that pre-date the tax engine. |
| taxCode | → TaxCode |  |  |
| kind | TaxTransactionKind | yes |  |
| sourceType | String | yes |  |
| invoiceId | String |  |  |
| invoice | → ClientInvoice |  |  |
| clientId | String |  |  |
| taxDate | DateTime | yes |  |
| taxableAmount | Decimal | yes |  |
| ratePct | Decimal | yes |  |
| taxAmount | Decimal | yes |  |
| reversed | Boolean |  |  |
| reversedAt | DateTime |  |  |
| createdAt | DateTime |  |  |

### JournalReversal

A request to reverse a posted manual journal. Someone else approves; approving posts a mirror journal and links it to the original, which stays in the ledger untouched.

| Field | Type | Required | What it holds |
| --- | --- | --- | --- |
| id | String |  | (key) |
| organizationId | String | yes |  |
| organization | → Organization |  |  |
| journalId | String | yes |  |
| journal | → JournalEntry |  |  |
| reason | String | yes |  |
| reverseDate | DateTime | yes | The date the reversal posts on (must be in a period that accepts postings). |
| status | JournalReversalStatus |  |  |
| requestedBy | String | yes |  |
| requestedByUserId | String | yes |  |
| createdAt | DateTime |  |  |
| decidedBy | String |  |  |
| decidedByUserId | String |  |  |
| decidedAt | DateTime |  |  |
| decisionNote | String |  |  |

## Fixed sets of values

### Role

`SUPER_ADMIN`, `COMPANY_ADMIN`, `HR_ADMIN`, `OPERATIONS`, `PAYROLL_ADMIN`, `FINANCE`, `AUDITOR`, `SUPERVISOR`, `EMPLOYEE`, `CLIENT_APPROVER`, `CLIENT_HR`, `BUSINESS_DEV`

### EmployeeStatus

`ACTIVE`, `INACTIVE`, `SUSPENDED`, `ON_LEAVE`, `TERMINATED`, `RESIGNED`, `EXITED`

### Gender

`MALE`, `FEMALE`

### DocumentType

`NATIONAL_ID`, `PASSPORT`, `DRIVERS_LICENSE`, `GUARD_LICENSE`, `FIREARMS_LICENSE`, `MEDICAL_CERTIFICATE`, `POLICE_CLEARANCE`, `EMPLOYMENT_CONTRACT`, `ACADEMIC_CERTIFICATE`, `OTHER`

### TrainingStatus

`VALID`, `EXPIRED`, `REVOKED`

### DisciplinaryType

`QUERY`, `VERBAL_WARNING`, `WRITTEN_WARNING`, `SUSPENSION`, `TERMINATION_RECOMMENDATION`, `COMMENDATION`

### ChecklistStatus

`PENDING`, `DONE`, `NOT_APPLICABLE`

### ExitType

`RESIGNATION`, `TERMINATION`, `END_OF_CONTRACT`, `RETIREMENT`, `ABSCONDMENT`, `DECEASED`

### ExitReasonCategory

Why an employee is leaving — drives attrition analytics and (for REDUNDANCY) severance.

`BETTER_PAY`, `CAREER_GROWTH`, `RELOCATION`, `PERSONAL_OR_HEALTH`, `WORK_CONDITIONS`, `MANAGER_RELATIONSHIP`, `PERFORMANCE`, `MISCONDUCT`, `REDUNDANCY`, `CONTRACT_END`, `RETIREMENT`, `DEATH`, `OTHER`

### EmploymentType

`PERMANENT`, `FIXED_TERM`, `PROBATION`, `CASUAL`, `CONSULTANT`, `INTERNSHIP`

### EmploymentContractStatus

`ACTIVE`, `SUPERSEDED`, `TERMINATED`, `EXPIRED`

### ProbationOutcome

`PENDING`, `CONFIRMED`, `EXTENDED`, `FAILED`

### ChecklistKind

`ONBOARDING`, `EXIT_CLEARANCE`

### RequisitionStatus

`PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ON_HOLD`, `FILLED`, `CLOSED`

### CandidateStage

`APPLIED`, `SCREENING`, `INTERVIEW`, `ASSESSMENT`, `OFFER`, `HIRED`, `REJECTED`, `WITHDRAWN`

### CandidateSource

`REFERRAL`, `JOB_BOARD`, `WALK_IN`, `AGENCY`, `INTERNAL`, `SOCIAL_MEDIA`, `OTHER`

### InterviewRecommendation

`STRONG_HIRE`, `HIRE`, `NO_HIRE`, `STRONG_NO_HIRE`

### CandidateCheckType

`REFERENCE`, `ID_VERIFICATION`, `POLICE_CLEARANCE`, `GUARANTOR`, `MEDICAL`, `EDUCATION`, `CREDIT`, `OTHER`

### CheckStatus

`PENDING`, `CLEARED`, `FAILED`, `WAIVED`

### OfferStatus

`PENDING_APPROVAL`, `APPROVED`, `SENT`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `WITHDRAWN`, `REJECTED`

### RelationsCaseType

`GRIEVANCE`, `MISCONDUCT`, `HARASSMENT`, `WHISTLEBLOWING`, `COUNSELLING`, `MEDIATION`, `OTHER`

### CaseSeverity

`LOW`, `MEDIUM`, `HIGH`

### CaseStatus

`OPEN`, `INVESTIGATING`, `HEARING`, `RESOLVED`, `CLOSED`

### CaseOutcome

`SUBSTANTIATED`, `PARTIALLY_SUBSTANTIATED`, `UNSUBSTANTIATED`, `RESOLVED_INFORMALLY`, `WITHDRAWN`

### CaseNoteKind

`NOTE`, `INVESTIGATION`, `HEARING`, `EVIDENCE`, `DECISION`, `APPEAL`

### SettlementStatus

`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `RELEASED`, `CANCELLED`

### SettlementLineKind

`EARNING`, `DEDUCTION`

### EosPayBasis

Which monthly figure a pay-in-service formula (gratuity, leave encashment) is based on.

`GROSS`, `BASIC`

### DeductionScope

`GLOBAL`, `LOCATION`, `INDIVIDUAL`

### RecurringDeductionCalcType

`PERCENTAGE_OF_GROSS`, `FIXED_AMOUNT`

### ClientStatus

`ACTIVE`, `INACTIVE`, `SUSPENDED`, `CLOSED`

### ContractStatus

`DRAFT`, `ACTIVE`, `EXPIRED`, `TERMINATED`

### BillingMethod

`PER_HEAD_MONTHLY`, `LUMP_SUM_MONTHLY`, `PER_SHIFT`

### BeatStatus

`UNMAPPED`, `MAPPED`, `UNDERSTAFFED`, `OVERSTAFFED`, `INACTIVE`

### StructureStatus

`DRAFT`, `ACTIVE`, `INACTIVE`

### StructureMethod

`PERCENTAGE_OF_GROSS`, `MIXED`

### ComponentCalcType

`PERCENTAGE`, `FIXED_AMOUNT`, `FORMULA`

### ApprovalStatus

`PENDING`, `APPROVED`, `REJECTED`, `PROCESSED`, `CANCELLED`

### DeploymentStatus

`ACTIVE`, `ENDED`

### MovementType

`PERMANENT_TRANSFER`, `TEMPORARY_TRANSFER`, `RELIEF`, `REPLACEMENT`, `CLIENT_TRANSFER`, `LOCATION_TRANSFER`, `SHIFT_CHANGE`

### AttendanceStatus

`PRESENT`, `LATE`, `ABSENT`, `LEAVE`, `OFF`, `SUSPENDED`

### Shift

`DAY`, `NIGHT`, `FULL`

### EntrySource

`MANUAL`, `IMPORT`, `SUPERVISOR`, `CLIENT_SCHEDULE`, `SYSTEM`

### PeriodStatus

`OPEN`, `PROCESSING`, `PENDING_VALIDATION`, `PENDING_APPROVAL`, `APPROVED`, `LOCKED`, `PAID`, `CLOSED`

### RunType

`REGULAR`, `SUPPLEMENTARY`

### RunStatus

`DRAFT`, `CALCULATED`, `PENDING_APPROVAL`, `APPROVED`, `LOCKED`, `PAID`, `SUPERSEDED`

### Severity

`CRITICAL`, `WARNING`, `INFO`

### DeductionType

`PENALTY`, `RECOVERY`, `LOAN`, `SALARY_ADVANCE`, `OTHER`

### ArrearsType

`SALARY_ADJUSTMENT`, `LATE_SALARY_INCREASE`, `PAYROLL_CORRECTION`, `MISSED_PAYMENT`, `RETROSPECTIVE_PROMOTION`, `APPROVED_ALLOWANCE`, `APPROVED_CORRECTION`

### ReliefType

`PERCENT_OF_GROSS`, `FIXED_ANNUAL`, `PERCENT_OF_RENT_CAPPED`, `EMPLOYEE_PENSION`, `NHF`, `NHIS`

### ProrationBasis

`CALENDAR_DAYS`, `FIXED_30`

### BusinessLine

Which line of business a contract belongs to. Back-office staff carry no contract at all (paid via EmployeePayRate) and are treated as their own segment by that absence.

`GUARDING`, `OUTSOURCING`

### PaymentStatus

`PENDING`, `PAID`, `FAILED`

### RemittanceType

`PAYE`, `PENSION`, `ITF`, `NSITF`, `NHF_MEDICAL`, `INSURANCE`, `UNIFORM_KITS`, `RECRUITMENT_TRAINING`, `LEAVE_RELIEVER`, `OUTSOURCING_LEAVE_ALLOWANCE`

### LeaveStatus

`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`

### GlAccountType

`ASSET`, `LIABILITY`, `EQUITY`, `INCOME`, `EXPENSE`

### GlHeadType

How a payroll head is posted: EARNING → debit expense; DEDUCTION → credit liability; EMPLOYER → debit expense + credit liability; NET_PAY → credit net salaries payable.

`EARNING`, `DEDUCTION`, `EMPLOYER`, `NET_PAY`

### InvoiceStatus

`DRAFT`, `SUBMITTED`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`

### VendorCategory

`UNIFORM_KITS`, `EQUIPMENT`, `UTILITIES`, `PROFESSIONAL_SERVICES`, `RENT`, `MAINTENANCE`, `OTHER`

### BillMatchStatus

Where a vendor bill stands against its purchase order and the goods or services received.

`NOT_REQUIRED`, `MATCHED`, `EXCEPTION`, `APPROVED`

### GoodsReceiptStatus

`POSTED`, `CANCELLED`

### PurchaseInvoiceStatus

`RECORDED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`

### PurchaseInvoiceDeductionType

`WITHHOLDING_TAX`, `OTHER`

### QueryStatus

`OPEN`, `ANSWERED`, `CLOSED`

### LeadStage

`QUALIFIED`, `DISCOVERY`, `PROPOSAL`, `PILOT`, `WON`, `LOST`

### LeadSegment

`SECURITY_FACILITIES`, `SME`, `OTHER`

### LeadSource

`OUTBOUND`, `INBOUND`, `REFERRAL`, `EVENT`, `OTHER`

### PartnerKind

`ACCOUNTANT`, `HR_CONSULTANT`, `OTHER`

### OutreachChannel

`CALL`, `EMAIL`, `WHATSAPP`, `LINKEDIN`, `MEETING`, `OTHER`

### OutreachOutcome

`NO_ANSWER`, `CONNECTED`, `MEETING_BOOKED`, `QUALIFIED`, `NOT_INTERESTED`

### ProposalStatus

`DRAFT`, `APPROVED`, `SENT`, `ACCEPTED`, `DECLINED`, `SUPERSEDED`, `WITHDRAWN`

### HealthCheckStatus

`IN_PROGRESS`, `IN_REVIEW`, `ISSUED`, `WITHDRAWN`

### ControlResponse

What was found for one control. "In place" means the control was seen operating, with evidence; it is never a certification.

`NOT_ASSESSED`, `IN_PLACE`, `PARTLY`, `NOT_SEEN`, `NOT_APPLICABLE`

### FindingSeverity

`HIGH`, `MEDIUM`, `LOW`, `OBSERVATION`

### ClientInputStatus

`SUBMITTED`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`

### ClientDecision

`APPROVED`, `REJECTED`

### InputItemStatus

`EXPECTED`, `RECEIVED`, `NOT_APPLICABLE`

### InputIssueStatus

`OPEN`, `RESOLVED`

### RuleKind

`TAX`, `PENSION`, `EMPLOYER_COST`

### RuleReleaseStatus

`PROPOSED`, `VERIFIED`, `PUBLISHED`, `WITHDRAWN`

### VerifierSlot

The two sign-offs a statutory rate change needs before it reaches any client: one from HR, one from Finance.

`HR`, `FINANCE`

### RulePublicationOutcome

`PUBLISHED`, `ALREADY_HELD`, `FAILED`

### EngagementPackage

`PAYROLL_ESSENTIALS`, `PAYROLL_COMPLIANCE`, `MANAGED_PAYROLL_PLUS`, `ENTERPRISE`, `HEALTH_CHECK`

### EngagementStatus

`ONBOARDING`, `ACTIVE`, `PAUSED`, `ENDED`

### InvoiceDeductionType

`WITHHOLDING_TAX`, `LEAVE_ALLOWANCE`, `OTHER`

### PurchaseOrderStatus

`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CONVERTED`, `CANCELLED`

### FixedAssetCategory

`VEHICLE`, `RADIO_COMMS`, `CCTV_SECURITY`, `FIREARM`, `OFFICE_EQUIPMENT`, `IT_EQUIPMENT`, `FURNITURE`, `OTHER`

### FixedAssetStatus

`ACTIVE`, `DISPOSED`

### BankLineMatchType

`CLIENT_RECEIPT`, `VENDOR_PAYMENT`, `MANUAL`

### InventoryCategory

`UNIFORM`, `FOOTWEAR`, `ACCESSORY`, `EQUIPMENT`, `OTHER`

### StockMovementType

`RECEIPT`, `ISSUE`, `RETURN`, `ADJUSTMENT`, `WRITE_OFF`

### ReturnCondition

What state kit comes back in. Only GOOD kit goes back on the shelf.

`GOOD`, `DAMAGED`, `LOST`

### LoanType

`LOAN`, `SALARY_ADVANCE`

### LoanStatus

`PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, `CANCELLED`, `WRITTEN_OFF`

### LoanInstallmentKind

How an instalment is settled: by a payroll deduction, by a deduction on the end-of-service settlement, or in cash/transfer paid straight to the company.

`PAYROLL`, `SETTLEMENT`, `CASH`

### LetterType

`OFFER`, `EMPLOYMENT_CONFIRMATION`, `PROBATION_CONFIRMATION`, `WARNING`, `EXIT_LETTER`, `EXPERIENCE`, `CLEARANCE_CERTIFICATE`

### ContactKind

`NEXT_OF_KIN`, `EMERGENCY_CONTACT`, `DEPENDANT`, `REFEREE`

### GuarantorStatus

`PENDING`, `VERIFIED`, `REJECTED`, `RELEASED`

### AppraisalKind

`ANNUAL`, `PROBATION`, `AD_HOC`

### AppraisalCycleStatus

`OPEN`, `CLOSED`

### AppraisalStatus

`DRAFT`, `SUBMITTED`, `APPROVED`, `ACKNOWLEDGED`

### AppraisalRecommendation

`NONE`, `CONFIRM_EMPLOYMENT`, `INCREMENT`, `PROMOTION`, `TRAINING`, `PERFORMANCE_PLAN`

### ChangeKind

`BANK`, `TAX`, `PENSION`

### ChangeStatus

`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`

### PolicyStatus

`ACTIVE`, `ARCHIVED`

### AckMethod

`SELF`, `RECORDED`

### DataRequestStatus

`OPEN`, `FULFILLED`, `REFUSED`

### BreachStatus

`OPEN`, `CLOSED`

### BreachAssessment

What the controller concluded about the harm a breach could do to the people affected. Until someone has assessed it the notification clock is treated as running.

`UNASSESSED`, `NO_RISK`, `RISK`, `HIGH_RISK`

### ErasureKind

`RETENTION`, `REQUEST`

### ErasureStatus

`PENDING`, `EXECUTED`, `REJECTED`

### AccountingPeriodStatus

`OPEN`, `SOFT_CLOSED`, `CLOSED`, `LOCKED`

### JournalDocumentKind

`MANUAL`, `ADJUSTMENT`, `ACCRUAL`, `RECLASSIFICATION`

### JournalDocumentStatus

`DRAFT`, `SUBMITTED`, `APPROVED`, `POSTED`, `REJECTED`, `CANCELLED`

### RecurrenceFrequency

`MONTHLY`, `QUARTERLY`, `YEARLY`

### ClientNoteType

`CREDIT`, `DEBIT`

### ClientNoteReason

`BILLING_ERROR`, `SERVICE_CREDIT`, `DISCOUNT`, `PRICE_ADJUSTMENT`, `PENALTY_OR_FEE`, `OTHER`

### NoteStatus

`PENDING`, `APPROVED`, `REJECTED`

### RefundStatus

`PENDING`, `APPROVED`, `REJECTED`

### BillingBase

`INDIRECT`, `DIRECT`, `FULL`, `NONE`

### BillingRuleStatus

`PENDING`, `APPROVED`, `REJECTED`

### TaxType

`VAT`, `WHT`

### TaxRateStatus

`PENDING`, `APPROVED`, `REJECTED`

### TaxTransactionKind

`OUTPUT_VAT`, `EXPECTED_WHT`

### JournalReversalStatus

`PENDING`, `APPROVED`, `REJECTED`

