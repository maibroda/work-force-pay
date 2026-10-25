import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { getQuery } from "@/server/services/client-queries";
import { PageHeader } from "@/components/page";
import { QueryThread } from "@/components/query-thread";
import { bureauCloseAction, bureauReplyAction } from "@/app/actions/client-queries";

export default async function ServiceDeskQueryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("query.respond");
  const { id } = await params;
  const q = await getQuery(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!q) notFound();
  return (
    <>
      <PageHeader title="Query" crumbs={[{ href: "/service-desk", label: "Service desk" }]} />
      <QueryThread q={q} bureauSide reply={bureauReplyAction.bind(null, id)} close={bureauCloseAction.bind(null, id)} />
    </>
  );
}
