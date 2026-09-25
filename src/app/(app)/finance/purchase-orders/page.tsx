import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPurchaseOrders } from "@/server/services/purchase-orders";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CONVERTED", "CANCELLED"];

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "payment.manage");
  const orders = await listPurchaseOrders(ctx, { status: sp.status });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Request → approve/reject → convert to a bill once it arrives. Vendors and cost centers are shared with Billing & Payables."
        actions={
          manage && (
            <Link className={buttonVariants()} href="/finance/purchase-orders/new">
              + Request order
            </Link>
          )
        }
      />

      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <Section title={`${orders.length} order(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Order</TH>
              <TH>Vendor</TH>
              <TH>Description</TH>
              <TH>Requested</TH>
              <TH className="text-right">Total</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {orders.map((o) => (
              <TR key={o.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/purchase-orders/${o.id}`}>
                    {o.orderNumber}
                  </Link>
                </TD>
                <TD>{o.vendor.name}</TD>
                <TD className="max-w-xs truncate text-xs">{o.description}</TD>
                <TD>{fmtDate(o.requestedAt)}</TD>
                <TD className="text-right">{naira(o.totalAmount)}</TD>
                <TD>
                  <StatusBadge status={o.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!orders.length && <Empty>No purchase orders yet — request one above.</Empty>}
      </Section>
    </>
  );
}
