"use client";
import Link from "next/link";
import { useActionState } from "react";
import { loginAction, verifyTotpLoginAction, type LoginState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState | undefined, FormData>(loginAction, undefined);
  const [totpState, totpAction, totpPending] = useActionState<LoginState | undefined, FormData>(
    verifyTotpLoginAction,
    undefined,
  );

  const challenge = totpState?.challenge ?? state?.challenge;
  if (state?.needsTotp || totpState?.needsTotp) {
    return (
      <form action={totpAction} className="space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <input type="hidden" name="challenge" value={challenge ?? ""} />
        <div className="space-y-1">
          <Label htmlFor="code">Authenticator code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456 or a backup code"
          />
        </div>
        {totpState?.error && <p className="text-sm text-destructive">{totpState.error}</p>}
        <Button type="submit" className="w-full" disabled={totpPending}>
          {totpPending ? "Verifying…" : "Verify"}
        </Button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-lg bg-white p-6 shadow-xl">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue="admin@demosecurity.test"
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
