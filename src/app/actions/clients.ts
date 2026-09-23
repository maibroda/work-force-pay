"use server";
import { act } from "./_run";
import * as svc from "@/server/services/clients";

type V = Record<string, unknown>;

export async function createClientAction(v: V) {
  return act(
    "client.manage",
    async (ctx) => {
      const c = await svc.createClient(ctx, v as never);
      return { message: `Client ${c.name} created.`, redirectTo: `/clients/${c.id}` };
    },
    ["/clients"],
  );
}
export async function updateClientAction(id: string, v: V) {
  return act(
    "client.manage",
    async (ctx) => {
      await svc.updateClient(ctx, id, v as never);
    },
    ["/clients"],
  );
}
export async function createContractAction(v: V) {
  return act(
    "client.manage",
    async (ctx) => {
      const c = await svc.createContract(ctx, v as never);
      return { message: `Contract ${c.contractNumber} created.` };
    },
    ["/contracts", "/clients"],
  );
}
export async function setContractBusinessLineAction(contractId: string, businessLine: string) {
  return act(
    "client.manage",
    async (ctx) => {
      await svc.setContractBusinessLine(ctx, contractId, businessLine as "GUARDING" | "OUTSOURCING");
      return {
        message: `Business line set to ${businessLine === "GUARDING" ? "Guarding" : "Outsourcing / Resourcing"}.`,
      };
    },
    ["/contracts", "/clients"],
  );
}
export async function addContractRateAction(v: V) {
  return act(
    "client.manage",
    async (ctx) => {
      await svc.addContractRate(ctx, v as never);
      return { message: "Agreed rate saved (previous rate end-dated)." };
    },
    ["/contracts", "/clients"],
  );
}
export async function createBeatAction(v: V) {
  return act(
    "client.manage",
    async (ctx) => {
      const b = await svc.createBeat(ctx, v as never);
      return { message: `Beat ${b.name} created as UNMAPPED — map employees in Deployment.` };
    },
    ["/beats", "/clients"],
  );
}
export async function updateStrengthAction(beatId: string, v: V) {
  return act(
    "client.manage",
    async (ctx) => {
      await svc.updateBeatStrength(ctx, beatId, Number(v.approvedStrength), v.reason as string | undefined);
      return { message: "Approved strength updated." };
    },
    ["/beats"],
  );
}
