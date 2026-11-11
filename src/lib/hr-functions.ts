/**
 * The Delegated HR Officer: a role that can do almost nothing on its own and gains abilities only through function grants from a FIXED list of four.
 *
 * Pure rules, no database. A grant adds only the permission of its function, never anything else; a grant counts only for someone whose role is Delegated HR Officer;
 * the Company Administrator who appoints an officer gains nothing; and a grant that is revoked, or past its end date, no longer counts. Grants are read on every request,
 * so revoking takes effect at once.
 */
import { can, type Permission, type Role } from "@/lib/auth/permissions";

export const HR_FUNCTIONS = ["WELFARE", "SURVEYS", "SURVEY_ASSIST", "SUCCESSION"] as const;
export type HrFunction = (typeof HR_FUNCTIONS)[number];

export const HR_FUNCTION_LABELS: Record<HrFunction, string> = {
  WELFARE: "Welfare cases",
  SURVEYS: "Surveys",
  SURVEY_ASSIST: "Assisted survey sessions",
  SUCCESSION: "Succession",
};

/** What each function opens. Fixed in code: a company cannot invent a function, so the audit story always covers it. */
export const FUNCTION_PERMISSIONS: Record<HrFunction, Permission[]> = {
  WELFARE: ["welfare.manage"],
  SURVEYS: ["survey.manage"],
  SURVEY_ASSIST: ["survey.assist"],
  SUCCESSION: ["succession.manage"],
};

export const ASSIGNABLE_PERMISSIONS: readonly Permission[] = Object.values(FUNCTION_PERMISSIONS).flat();
const ASSIGNABLE = new Set<Permission>(ASSIGNABLE_PERMISSIONS);

export interface GrantLike {
  function: HrFunction;
  /** The last day the grant counts ("YYYY-MM-DD"), or null for no end. */
  endsOn: string | null;
  revokedAt: string | null;
}

/** The functions whose grants are live on this day: not revoked, and not past their end date (the end date itself still counts). */
export function liveFunctions(grants: GrantLike[], today: string): HrFunction[] {
  const live = grants.filter((g) => !g.revokedAt && (g.endsOn === null || g.endsOn >= today)).map((g) => g.function);
  return [...new Set(live)];
}

/** The permissions a set of live functions opens. */
export const permissionsOf = (functions: HrFunction[]): Permission[] => functions.flatMap((f) => FUNCTION_PERMISSIONS[f]);

/**
 * Whether this person may do this. The role table first; then, only for a Delegated HR Officer and only for the four assignable permissions, the live grants
 * carried by the request. Nothing outside the four can ever be opened by a grant.
 */
export function canCtx(ctx: { role: Role; grants?: Permission[] }, permission: Permission): boolean {
  if (can(ctx.role, permission)) return true;
  return ctx.role === "HR_OFFICER" && ASSIGNABLE.has(permission) && (ctx.grants ?? []).includes(permission);
}

/** Which of the four functions nobody in the company holds: an HR administrator holds all four; an officer holds only the functions of their live grants. */
export function unheldFunctions(people: Array<{ role: Role | string; functions: HrFunction[] }>): HrFunction[] {
  const held = new Set<HrFunction>();
  for (const p of people) {
    if (p.role === "HR_ADMIN") HR_FUNCTIONS.forEach((f) => held.add(f));
    else if (p.role === "HR_OFFICER") p.functions.forEach((f) => held.add(f));
  }
  return HR_FUNCTIONS.filter((f) => !held.has(f));
}

/** An external officer's access ends after their end date (the day itself still works). No end date means it does not end. */
export function accessEnded(accessEndsOn: string | null, today: string): boolean {
  return accessEndsOn !== null && accessEndsOn < today;
}

