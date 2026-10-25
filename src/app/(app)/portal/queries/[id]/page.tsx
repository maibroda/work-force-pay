import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { getQuery } from "@/server/services/client-queries";
import { PageHeader } from "@/components/page";
import { QueryThread } from "@/components/query-thread";
import { clientCloseAction, clientReplyAction } from "@/app/actions/client-queries";

export default async function PortalQueryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("portal.query");
  const { id } = await params;
  const q = await getQuery(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!q) notFound();
  return (
    <>
      <PageHeader title="Query" crumbs={[{ href: "/portal/queries", label: "Your queries" }]} />
      <QueryThread q={q} bureauSide={false} reply={clientReplyAction.bind(null, id)} close={clientCloseAction.bind(null, id)} />
    </>
  );
}
