"use server";
import { redirect } from "next/navigation";
import { createSession, destroySession, getSession } from "@/lib/auth/session";
import { authenticate } from "@/server/services/users";
import { logAudit } from "@/server/services/audit";

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const user = await authenticate(email, password);
  if (!user) return { error: "Invalid email or password." };
  const ctx = {
    userId: user.id,
    orgId: user.organizationId,
    role: user.role,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
  };
  await createSession(ctx);
  await logAudit(ctx, { action: "LOGIN", entity: "User", entityId: user.id });
  redirect(user.role === "EMPLOYEE" ? "/me" : user.role === "SUPERVISOR" ? "/supervisor" : "/");
}

export async function logoutAction() {
  const ctx = await getSession();
  if (ctx) await logAudit(ctx, { action: "LOGOUT", entity: "User", entityId: ctx.userId });
  await destroySession();
  redirect("/login");
}
