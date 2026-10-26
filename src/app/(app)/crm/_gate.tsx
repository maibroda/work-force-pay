import type { Ctx } from "@/lib/auth/context";
import { crmAvailable } from "@/server/services/crm";
import { PageHeader } from "@/components/page";

/**
 * The pipeline lives in a payroll bureau's own organization. In any other organization, or while working inside a client, the page says so
 * plainly instead of failing; returns null when the pipeline is available.
 */
export async function crmGate(ctx: Ctx, title: string) {
  if (await crmAvailable(ctx)) return null;
  return (
    <PageHeader
      title={title}
      description={ctx.homeOrgId ? "The sales pipeline belongs to the bureau's own organization. Go back to the bureau to use it." : "The sales pipeline belongs to a payroll bureau's own organization."}
    />
  );
}
