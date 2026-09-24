import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getSession()) redirect("/");
  const { token } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="rounded-lg bg-white p-6 text-sm text-destructive shadow-xl">
            This link is missing its reset token — request a new one from the sign-in page.
          </p>
        )}
      </div>
    </main>
  );
}
