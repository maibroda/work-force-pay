import type { Ctx } from "@/lib/auth/context";
import { taskDocumentView } from "@/server/services/documents";
import { TaskDocument } from "@/components/task-document";

/**
 * In place of "Mark complete" for a checklist step that follows a document: the document's state and the way to upload it. A step with no
 * document type shows what it always did (the children), completed by hand.
 */
export function TaskDocumentCell({
  ctx,
  kind,
  task,
  employeeId,
  children,
}: {
  ctx: Ctx;
  kind: "ONBOARDING" | "EXIT";
  task: Parameters<typeof taskDocumentView>[1];
  employeeId: string;
  children?: React.ReactNode;
}) {
  const view = taskDocumentView(ctx, task);
  if (!view) return <>{children}</>;
  return <TaskDocument kind={kind} taskId={task.id} employeeId={employeeId} {...view} />;
}
