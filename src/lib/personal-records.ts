/**
 * Pure rules for employees' personal records: next of kin, emergency contacts, dependants, referees
 * and guarantors. No database here — the service loads the rows and these functions decide.
 */

export const CONTACT_KINDS = ["NEXT_OF_KIN", "EMERGENCY_CONTACT", "DEPENDANT", "REFEREE"] as const;
export type ContactKindName = (typeof CONTACT_KINDS)[number];

export const CONTACT_LABELS: Record<ContactKindName, string> = {
  NEXT_OF_KIN: "Next of kin",
  EMERGENCY_CONTACT: "Emergency contact",
  DEPENDANT: "Dependant",
  REFEREE: "Referee",
};

/** Kinds that can be marked the main one, and kinds that can receive a share of a benefit. */
export const PRIMARY_KINDS: readonly ContactKindName[] = ["NEXT_OF_KIN", "EMERGENCY_CONTACT"];
export const BENEFICIARY_KINDS: readonly ContactKindName[] = ["NEXT_OF_KIN", "DEPENDANT"];

export const RELATIONSHIPS = ["Spouse", "Partner", "Parent", "Child", "Sibling", "Relative", "Friend", "Colleague", "Employer", "Pastor / Imam", "Community leader", "Other"];

export const GUARANTOR_ID_TYPES = [
  { value: "NIN", label: "National ID (NIN)" },
  { value: "VOTERS_CARD", label: "Voter's card" },
  { value: "DRIVERS_LICENCE", label: "Driver's licence" },
  { value: "INTL_PASSPORT", label: "International passport" },
  { value: "OTHER", label: "Other" },
];

/** What a phone number is compared by: digits only, last ten (so 0803… and +234803… match). */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export const samePhone = (a: string | null | undefined, b: string | null | undefined) => {
  const x = phoneKey(a);
  return x.length >= 7 && x === phoneKey(b);
};

export const sameId = (a: string | null | undefined, b: string | null | undefined) => {
  const x = (a ?? "").replace(/\s+/g, "").toUpperCase();
  return x.length >= 4 && x === (b ?? "").replace(/\s+/g, "").toUpperCase();
};

/** Whole years between a date of birth and `on` (UTC dates). */
export function ageOn(dob: Date, on: Date): number {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = on.getUTCMonth() < dob.getUTCMonth() || (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export interface ShareRow {
  isBeneficiary: boolean;
  benefitSharePct: number | null;
}

/** Total of the benefit shares handed out, and whether the split is complete. */
export function benefitShares(rows: ShareRow[]) {
  const beneficiaries = rows.filter((r) => r.isBeneficiary);
  const total = beneficiaries.reduce((a, r) => a + (r.benefitSharePct ?? 0), 0);
  return { count: beneficiaries.length, total, complete: beneficiaries.length > 0 && total === 100, over: total > 100 };
}

export interface RecordsPolicy {
  nextOfKinRequired: number;
  emergencyContactsRequired: number;
  guarantorsRequired: number;
  guarantorCategoryIds: string[];
}

/** How many guarantors this employee's category needs (0 = none). */
export function guarantorsNeeded(policy: RecordsPolicy, categoryId: string): number {
  if (policy.guarantorsRequired <= 0) return 0;
  return policy.guarantorCategoryIds.length === 0 || policy.guarantorCategoryIds.includes(categoryId) ? policy.guarantorsRequired : 0;
}

export interface RecordsGaps {
  nextOfKinMissing: number;
  emergencyMissing: number;
  guarantorsNeeded: number;
  guarantorsVerified: number;
  guarantorsPending: number;
  /** Still to be verified before the requirement is met. */
  guarantorsMissing: number;
  complete: boolean;
}

export function assessRecords(
  policy: RecordsPolicy,
  categoryId: string,
  contacts: Array<{ kind: ContactKindName }>,
  guarantors: Array<{ status: "PENDING" | "VERIFIED" | "REJECTED" | "RELEASED" }>,
): RecordsGaps {
  const count = (k: ContactKindName) => contacts.filter((c) => c.kind === k).length;
  const verified = guarantors.filter((g) => g.status === "VERIFIED").length;
  const pending = guarantors.filter((g) => g.status === "PENDING").length;
  const needed = guarantorsNeeded(policy, categoryId);
  const g = {
    nextOfKinMissing: Math.max(0, policy.nextOfKinRequired - count("NEXT_OF_KIN")),
    emergencyMissing: Math.max(0, policy.emergencyContactsRequired - count("EMERGENCY_CONTACT")),
    guarantorsNeeded: needed,
    guarantorsVerified: verified,
    guarantorsPending: pending,
    guarantorsMissing: Math.max(0, needed - verified),
  };
  return { ...g, complete: g.nextOfKinMissing === 0 && g.emergencyMissing === 0 && g.guarantorsMissing === 0 };
}
