import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getClientInputs } from "@/server/services/client-inputs";
import { PageHeader } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { ClientInputBatch } from "@/components/client-input-batch";
import { acceptClientInputsAction, rejectClientInputsAction } from "@/app/actions/client-inputs";

export default async function ReviewClientInputsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("payroll.view");
  const { id } = await params;
  const b = await getClientInputs(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!b) notFound();
  const decide = b.status === "SUBMITTED" && can(ctx.role, "payroll.inputs.approve");
  return (
    <>
      <PageHeader title="Review client inputs" crumbs={[{ href: "/payroll/client-inputs", label: "Client inputs" }]} />
      <ClientInputBatch
        b={b}
        actions={
          decide && (
            <span className="flex flex-wrap items-center gap-2">
              {!b.blockers.length && (
                <ActionButton action={acceptClientInputsAction.bind(null, b.id)} confirm={`Add these ${b.rowCount} input(s) to ${b.period.name}?`}>
                  Accept
                </ActionButton>
              )}
              <ActionButton action={rejectClientInputsAction.bind(null, b.id)} variant="outline" reason reasonPlaceholder="What must the client change?">
                Send back
              </ActionButton>
            </span>
          )
        }
      />
    </>
  );
}
