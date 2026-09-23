import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <h1 className="text-2xl font-semibold tracking-tight">WorkforcePay</h1>
          <p className="mt-1 text-sm text-slate-400">Workforce deployment, beat management & payroll</p>
        </div>
        <LoginForm />
        <div className="mt-6 rounded-lg border border-slate-700 p-3 text-xs text-slate-400">
          <p className="mb-1 font-medium text-slate-300">Demo accounts (password: Password123!)</p>
          <ul className="grid grid-cols-1 gap-0.5">
            <li>admin@demosecurity.test — Company Admin</li>
            <li>payroll@demosecurity.test — Payroll Admin</li>
            <li>finance@demosecurity.test — Finance (approve/lock)</li>
            <li>ops@demosecurity.test — Operations</li>
            <li>hr@demosecurity.test — HR Admin</li>
            <li>auditor@demosecurity.test — Auditor (read-only)</li>
            <li>supervisor@demosecurity.test — Supervisor (mobile)</li>
            <li>emp25@demosecurity.test — Employee EMP-000025</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
