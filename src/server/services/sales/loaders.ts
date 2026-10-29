/** Records a caller may see, loaded inside a transaction when one is given. A record they may not see (or another organization's) is "not found". */
import type { Ctx } from "@/lib/auth/context";
import { BusinessError, db, type Tx } from "../_base";
import { ownerFilter } from "./access";

type Client = Tx | typeof db;

export async function visibleAccount(ctx: Ctx, tx: Client, id: string) {
  const a = await tx.crmAccount.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!a) throw new BusinessError("Account not found.");
  if (a.status === "VOID") throw new BusinessError("A voided account cannot be used.");
  return a;
}

export async function visibleContact(ctx: Ctx, tx: Client, id: string) {
  const c = await tx.crmContact.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!c) throw new BusinessError("Contact not found.");
  if (c.status === "VOID") throw new BusinessError("A voided contact cannot be used.");
  return c;
}
