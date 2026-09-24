"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction, type SimpleState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<SimpleState | undefined, FormData>(
    requestPasswordResetAction,
    undefined,
  );

  if (state?.ok) {
    return (
      <div className="space-y-4 rounded-lg bg-white p-6 text-sm shadow-xl">
        <p>If an account exists for that email, a reset link has been sent. It expires in 30 minutes.</p>
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-lg bg-white p-6 shadow-xl">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="block text-center text-xs text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
