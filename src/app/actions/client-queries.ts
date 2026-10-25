"use server";
import { act } from "./_run";
import * as q from "@/server/services/client-queries";
import * as portal from "@/server/services/portal";

type V = Record<string, unknown>;
const PATHS = ["/portal/queries", "/service-desk", "/bureau/queries"];

export async function raiseQueryAction(v: V) {
  return act(
    "portal.query",
    async (ctx) => {
      const r = await q.raiseQuery(ctx, v as never);
      return { message: `${r.number} raised. The bureau will reply here.`, redirectTo: `/portal/queries/${r.id}` };
    },
    PATHS,
  );
}

export async function clientReplyAction(id: string, v: V) {
  return act("portal.query", async (ctx) => {
    await q.replyToQuery(ctx, id, String(v.body ?? ""));
    return { message: "Sent." };
  }, PATHS);
}

export async function clientCloseAction(id: string) {
  return act("portal.query", async (ctx) => {
    await q.closeQuery(ctx, id);
    return { message: "Query closed." };
  }, PATHS);
}

export async function bureauReplyAction(id: string, v: V) {
  return act("query.respond", async (ctx) => {
    await q.replyToQuery(ctx, id, String(v.body ?? ""));
    return { message: "Reply sent." };
  }, PATHS);
}

export async function bureauCloseAction(id: string) {
  return act("query.respond", async (ctx) => {
    await q.closeQuery(ctx, id);
    return { message: "Query closed." };
  }, PATHS);
}

export async function requestEmployeeChangeAction(employeeId: string, kind: "BANK" | "TAX" | "PENSION", v: V) {
  return act(
    "portal.changes",
    async (ctx) => {
      await portal.portalRequestChange(ctx, employeeId, kind, v, String(v.reason ?? ""));
      return { message: "Sent to the bureau for approval. Nothing changes until they approve it." };
    },
    ["/portal/employees"],
  );
}
