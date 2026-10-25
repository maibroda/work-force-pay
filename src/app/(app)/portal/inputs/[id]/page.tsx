import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getClientInputs } from "@/server/services/client-inputs";
import { PageHeader } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { ClientInputBatch } from "@/components/client-input-batch";
import { withdrawClientInputsAction } from "@/app/actions/client-inputs";

export default async function PortalInputBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("portal.view");
  const { id } = await params;
  const b = await getClientInputs(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!b) notFound();
  return (
    <>
      <PageHeader title="Inputs you sent" crumbs={[{ href: "/portal/inputs", label: "Send inputs" }]} />
      <ClientInputBatch
        b={b}
        actions={
          b.status === "SUBMITTED" &&
          can(ctx.role, "portal.inputs") && (
            <ActionButton action={withdrawClientInputsAction.bind(null, b.id)} variant="outline" confirm="Take this back? Nothing has reached the payroll yet.">
              Withdraw
            </ActionButton>
          )
        }
      />
    </>
  );
}
