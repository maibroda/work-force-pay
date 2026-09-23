import type { Role } from "./permissions";

/** Request context passed to every service. organizationId scopes ALL data access. */
export interface Ctx {
  userId: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
  employeeId?: string | null;
  ip?: string | null;
}
