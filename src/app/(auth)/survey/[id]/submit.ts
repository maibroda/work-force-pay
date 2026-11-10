"use server";
import { headers } from "next/headers";
import { clientIp } from "@/lib/rate-limit";
import { submitWithCode } from "@/server/services/survey";

/**
 * Submits an anonymous survey answer with an access code, with no login (a phone, a shared device or an assisted session). It deliberately does NOT use the signed-in
 * action wrapper: there is no session. The code is the only credential, it is single-use, and a person who keeps guessing is slowed down by address. The reply never says
 * why a code failed.
 */
export async function submitPublicSurveyAction(surveyId: string, code: string, answers: Array<{ questionId: string; value?: number; comment?: string }>): Promise<{ status: "ok" | "invalid" | "slow" | "bad"; message?: string }> {
  try {
    return await submitWithCode(surveyId, code, answers, clientIp(await headers()));
  } catch (e) {
    // a bad answer (nothing answered, a rating out of range) is the person's to fix, and the code has not been used
    return { status: "bad", message: e instanceof Error ? e.message : "Check your answers and try again." };
  }
}
