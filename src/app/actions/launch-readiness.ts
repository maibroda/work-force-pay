"use server";
import { act } from "./_run";
import * as launch from "@/server/services/launch-readiness";

type V = Record<string, unknown>;
const PATHS = ["/bureau/readiness", "/bureau"];

export async function confirmLaunchCheckAction(key: string, v: V) {
  return act(
    "bureau.manage",
    async (ctx) => {
      await launch.confirmLaunchCheck(ctx, key, String(v.note ?? ""));
      return { message: "Confirmed." };
    },
    PATHS,
  );
}

export async function withdrawLaunchCheckAction(key: string, reason?: string) {
  return act(
    "bureau.manage",
    async (ctx) => {
      await launch.withdrawLaunchCheck(ctx, key, reason ?? "");
      return { message: "No longer confirmed." };
    },
    PATHS,
  );
}

export async function sendTestEmailAction() {
  return act("bureau.manage", async (ctx) => {
    const r = await launch.sendTestEmail(ctx);
    return {
      message: r.live ? `Sent to ${r.to}. Check that it arrived and that the PDF opens.` : `No email provider is configured, so nothing was sent: the message was only written to the server log.`,
    };
  });
}
