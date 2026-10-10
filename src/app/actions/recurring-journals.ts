"use server";
import { act } from "./_run";
import * as rj from "@/server/services/recurring-journals";

type V = Record<string, unknown>;
const PATHS = ["/accounting"];

/** The editor sends the lines as JSON; checkboxes arrive as real booleans. */
const templateFrom = (v: V) => ({ ...v, lines: JSON.parse(String(v.linesJson ?? "[]")) });

export async function saveTemplateAction(id: string | null, v: V) {
  return act(
    "journal.manage",
    async (ctx) => {
      const t = await rj.saveTemplate(ctx, id, templateFrom(v) as never);
      return { message: `${t.name} saved.`, redirectTo: `/accounting/recurring-journals/${t.id}` };
    },
    PATHS,
  );
}

export async function setTemplateActiveAction(id: string, active: boolean) {
  return act("journal.manage", async (ctx) => {
    await rj.setTemplateActive(ctx, id, active);
    return { message: active ? "Resumed. Any dates missed while it was paused will be generated on the next run." : "Paused. Nothing more is generated until it is resumed." };
  }, PATHS);
}

export async function deleteTemplateAction(id: string) {
  return act("journal.manage", async (ctx) => {
    await rj.deleteTemplate(ctx, id);
    return { message: "Template deleted.", redirectTo: "/accounting/recurring-journals" };
  }, PATHS);
}

export async function runDueNowAction() {
  return act("journal.manage", async (ctx) => {
    const r = await rj.runDueNow(ctx, new Date());
    const base = r.generated ? `${r.generated} journal${r.generated === 1 ? "" : "s"} generated${r.submitted ? `, ${r.submitted} submitted for approval` : ""}.` : "Nothing was due.";
    return { message: r.notes.length ? `${base} Held as drafts: ${r.notes.join("; ")}` : base };
  }, PATHS);
}
