import Link from "next/link";
import { MODULES, type ModuleKey } from "@/lib/entitlements/catalogue";
import { refusalMessage } from "@/lib/entitlements/guard";

/** A role without permission, or (with ?module=) a module the company did not buy: the guards send people here. */
export default async function Forbidden({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module } = await searchParams;
  const notBought = module && Object.prototype.hasOwnProperty.call(MODULES, module) && module !== "core" ? refusalMessage(module as ModuleKey) : null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{notBought ? "Not part of your plan" : "Access denied"}</h1>
      <p className="text-sm text-muted-foreground">{notBought ?? "Your role does not have permission to open this page."}</p>
      <Link className="text-sm text-primary underline" href="/">
        Back to dashboard
      </Link>
    </main>
  );
}
