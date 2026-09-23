"use server";
import { act } from "./_run";
import * as hr from "@/server/services/hr";

type V = Record<string, unknown>;
const PATHS = ["/employees"];

export async function addDocumentAction(v: V) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.addDocument(ctx, v as never);
      return { message: "Document recorded." };
    },
    PATHS,
  );
}
export async function deleteDocumentAction(id: string) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.deleteDocument(ctx, id);
      return { message: "Document removed." };
    },
    PATHS,
  );
}
export async function addTrainingAction(v: V) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.addTraining(ctx, v as never);
      return { message: "Training / certification recorded." };
    },
    PATHS,
  );
}
export async function revokeTrainingAction(id: string, reason?: string) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.revokeTraining(ctx, id, reason ?? "Revoked");
      return { message: "Certification revoked." };
    },
    PATHS,
  );
}
export async function raiseDisciplinaryAction(v: V) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.raiseDisciplinary(ctx, v as never);
      return { message: "Disciplinary record raised — pending sign-off." };
    },
    PATHS,
  );
}
export async function approveDisciplinaryAction(id: string, remarks?: string) {
  return act(
    "hr.approve",
    async (ctx) => {
      await hr.approveDisciplinary(ctx, id, remarks);
      return { message: "Disciplinary record approved." };
    },
    PATHS,
  );
}
export async function rejectDisciplinaryAction(id: string, remarks?: string) {
  return act(
    "hr.approve",
    async (ctx) => {
      await hr.rejectDisciplinary(ctx, id, remarks ?? "Rejected");
      return { message: "Disciplinary record rejected." };
    },
    PATHS,
  );
}
export async function addOnboardingTaskAction(v: V) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.addOnboardingTask(
        ctx,
        String(v.employeeId),
        String(v.taskName),
        v.dueDate ? String(v.dueDate) : undefined,
      );
      return { message: "Onboarding task added." };
    },
    PATHS,
  );
}
export async function completeOnboardingTaskAction(id: string) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.completeOnboardingTask(ctx, id);
      return { message: "Task marked complete." };
    },
    PATHS,
  );
}
export async function initiateExitAction(v: V) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.initiateExit(ctx, v as never);
      return { message: "Exit initiated — pending sign-off." };
    },
    PATHS,
  );
}
export async function approveExitAction(id: string, remarks?: string) {
  return act(
    "hr.approve",
    async (ctx) => {
      await hr.approveExit(ctx, id, remarks);
      return { message: "Exit approved — employee status updated and clearance checklist created." };
    },
    PATHS,
  );
}
export async function rejectExitAction(id: string, remarks?: string) {
  return act(
    "hr.approve",
    async (ctx) => {
      await hr.rejectExit(ctx, id, remarks ?? "Rejected");
      return { message: "Exit rejected." };
    },
    PATHS,
  );
}
export async function completeExitTaskAction(id: string) {
  return act(
    "hr.manage",
    async (ctx) => {
      await hr.completeExitTask(ctx, id);
      return { message: "Clearance item marked complete." };
    },
    PATHS,
  );
}
