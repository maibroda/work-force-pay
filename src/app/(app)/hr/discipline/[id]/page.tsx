import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getCase } from "@/server/services/relations";
import { CaseFile } from "@/components/case-file";

export default async function DisciplinaryCasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("discipline.view");
  const { id } = await params;
  const c = await getCase(ctx, id).catch(() => null);
  if (!c) notFound();
  if (c.type !== "MISCONDUCT") redirect(`/hr/relations/${c.id}`); // only misconduct is disciplinary
  return <CaseFile ctx={ctx} c={c} />;
}
