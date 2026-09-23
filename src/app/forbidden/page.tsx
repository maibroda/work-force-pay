import Link from "next/link";
export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">Your role does not have permission to open this page.</p>
      <Link className="text-sm text-primary underline" href="/">
        Back to dashboard
      </Link>
    </main>
  );
}
