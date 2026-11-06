import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getCase } from "@/server/services/relations";
import { CaseFile } from "@/components/case-file";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const c = await getCase(ctx, id).catch(() => null); // a misconduct case is "not found" to someone without disciplinary access
  if (!c) notFound();
  if (c.type === "MISCONDUCT") redirect(`/hr/discipline/${c.id}`); // misconduct has its own page
  return <CaseFile ctx={ctx} c={c} />;
}
