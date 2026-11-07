import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { ForbiddenError } from "@/lib/auth/permissions";
import { MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } from "@/lib/documents";
import { BusinessError } from "@/server/services/_base";
import { replaceDocument, uploadDocument } from "@/server/services/documents";
import { routeRefusal } from "@/server/services/entitlement-guard";

export const dynamic = "force-dynamic";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/**
 * Uploads one or several files for an employee (a new document each), or one replacement file for an existing document (documentId).
 * Everything is checked again on the server by the service: who may do it, the file's type, size and contents, the employee and the type.
 * The answer lists each file with its own success or error, so one bad file does not lose the others.
 */
export async function POST(req: Request) {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under Settings, Security." }, { status: 403 });
  const off = routeRefusal(ctx, "/api/documents/upload");
  if (off) return off;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The upload could not be read. A single request is limited to about 12 MB: upload larger files one at a time." }, { status: 400 });
  }
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (!files.length) return NextResponse.json({ error: "Choose at least one file." }, { status: 400 });
  if (files.length > MAX_FILES_PER_UPLOAD) return NextResponse.json({ error: `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.` }, { status: 400 });

  const documentId = text(form, "documentId");
  const taskKind = text(form, "taskKind");
  const taskId = text(form, "taskId");
  const task = taskId && (taskKind === "ONBOARDING" || taskKind === "EXIT") ? { kind: taskKind as "ONBOARDING" | "EXIT", id: taskId } : undefined;
  if (documentId && files.length > 1) return NextResponse.json({ error: "A replacement is one file." }, { status: 400 });
  const common = {
    employeeId: text(form, "employeeId") ?? "",
    typeId: text(form, "typeId") ?? "",
    description: text(form, "description"),
    issueDate: text(form, "issueDate"),
    expiryDate: text(form, "expiryDate"),
    reference: text(form, "reference"),
  };

  const results: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      results.push({ name: file.name, ok: false, error: "The file is larger than 10 MB." }); // refused before it is read
      continue;
    }
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (documentId) await replaceDocument(ctx, documentId, { typeId: common.typeId || undefined, file: { name: file.name, bytes } });
      else await uploadDocument(ctx, { ...common, task, file: { name: file.name, bytes } });
      results.push({ name: file.name, ok: true });
    } catch (e) {
      if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (e instanceof BusinessError) results.push({ name: file.name, ok: false, error: e.message });
      else if (e instanceof ZodError) results.push({ name: file.name, ok: false, error: e.issues.map((i) => i.message).join("; ") });
      else throw e;
    }
  }
  return NextResponse.json({ results });
}
