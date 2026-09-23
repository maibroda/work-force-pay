import { requirePage } from "@/lib/auth/session";
import { InfoTable } from "../_info-table";

export default async function Page() {
  const ctx = await requirePage("employee.sensitive");
  return <InfoTable ctx={ctx} kind="tax" />;
}
