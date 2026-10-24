"use server";
import { act } from "./_run";
import * as lib from "@/server/services/rule-library";

type V = Record<string, unknown>;
const PATHS = ["/bureau/rules"];

export async function proposeReleaseAction(v: V) {
  return act(
    "rules.manage",
    async (ctx) => {
      // the form sends the rule as "KIND:id"
      const [kind, ruleId] = String(v.rule ?? "").split(":");
      const r = await lib.proposeRelease(ctx, { kind, ruleId, summary: String(v.summary ?? ""), source: String(v.source ?? "") } as never);
      return { message: `${r.label} proposed. It needs HR and Finance to verify it.`, redirectTo: `/bureau/rules/${r.id}` };
    },
    PATHS,
  );
}

export async function verifyReleaseAction(id: string, note?: string) {
  return act(
    "rules.verify",
    async (ctx) => {
      const r = await lib.verifyRelease(ctx, id, note ?? "");
      return { message: r.verified ? "Verified. Both HR and Finance have signed off, so it can be published." : "Your verification is recorded. The other sign-off is still needed." };
    },
    PATHS,
  );
}

export async function withdrawReleaseAction(id: string, reason?: string) {
  return act(
    "rules.manage",
    async (ctx) => {
      await lib.withdrawRelease(ctx, id, reason ?? "");
      return { message: "Release withdrawn." };
    },
    PATHS,
  );
}

export async function publishReleaseAction(id: string) {
  return act(
    "rules.manage",
    async (ctx) => {
      const results = await lib.publishRelease(ctx, id);
      const n = (o: string) => results.filter((r) => r.outcome === o).length;
      const failed = results.filter((r) => r.outcome === "FAILED");
      return {
        message: `Published to ${n("PUBLISHED")} client(s)${n("ALREADY_HELD") ? `, ${n("ALREADY_HELD")} already held it` : ""}${failed.length ? `. ${failed.length} could not take it: ${failed.map((f) => `${f.clientName} (${f.message})`).join("; ")}` : "."}`,
      };
    },
    PATHS,
  );
}
