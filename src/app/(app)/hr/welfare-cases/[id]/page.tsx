import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getCase } from "@/server/services/relations";
import { CaseFile } from "@/components/case-file";

export default async function WelfareCasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("welfare.manage");
  const { id } = await params;
  const c = await getCase(ctx, id).catch(() => null);
  // only a welfare case opens here: any other case is "not found", whatever its id
  if (!c || c.type !== "WELFARE") notFound();
  return <CaseFile ctx={ctx} c={c} welfare />;
}
