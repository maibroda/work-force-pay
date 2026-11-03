import type { Entitlements } from "@/lib/entitlements/guard";
import type { Role } from "./permissions";

/** Request context passed to every service. organizationId scopes ALL data access. */
export interface Ctx {
  userId: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
  employeeId?: string | null;
  /** Set while bureau staff are working in a client organization: the bureau organization they belong to. `orgId` is then the client. */
  homeOrgId?: string | null;
  ip?: string | null;
  /** What the company's modules allow, for the guards in src/server/services/entitlement-guard.ts. Not set by anything yet (E3b), so nothing is checked. */
  entitlements?: Entitlements;
}
