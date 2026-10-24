import { db } from "@/lib/db";
import { can, type Role } from "./permissions";

/**
 * Whether a user may work in `targetOrgId`: their own organization, or a client of the bureau they work for. Bureau managers can work in
 * every client of their bureau; everyone else only in the clients they have been given. Checked on every request while someone is
 * working in a client, never taken from the session token alone.
 */
export async function mayWorkIn(user: { id: string; organizationId: string; role: Role }, targetOrgId: string): Promise<boolean> {
  if (targetOrgId === user.organizationId) return true;
  const target = await db.organization.findUnique({ where: { id: targetOrgId }, select: { bureauOrganizationId: true } });
  if (!target || target.bureauOrganizationId !== user.organizationId) return false;
  if (can(user.role, "bureau.manage")) return true;
  if (!can(user.role, "bureau.view")) return false;
  const grant = await db.staffClientAccess.findUnique({ where: { userId_clientOrganizationId: { userId: user.id, clientOrganizationId: targetOrgId } }, select: { id: true } });
  return !!grant;
}
