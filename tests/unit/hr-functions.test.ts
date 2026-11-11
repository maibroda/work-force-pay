import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, can, type Permission, type Role } from "@/lib/auth/permissions";
import { ASSIGNABLE_PERMISSIONS, FUNCTION_PERMISSIONS, HR_FUNCTIONS, accessEnded, canCtx, liveFunctions, unheldFunctions } from "@/lib/hr-functions";

const ctx = (role: Role, grants?: Permission[]) => ({ role, grants });

describe("the four functions an officer can be given", () => {
  it("are fixed in code, each opening exactly its own permission", () => {
    expect([...HR_FUNCTIONS]).toEqual(["WELFARE", "SURVEYS", "SURVEY_ASSIST", "SUCCESSION"]);
    expect(FUNCTION_PERMISSIONS).toEqual({ WELFARE: ["welfare.manage"], SURVEYS: ["survey.manage"], SURVEY_ASSIST: ["survey.assist"], SUCCESSION: ["succession.manage"] });
    expect([...ASSIGNABLE_PERMISSIONS].sort()).toEqual(["succession.manage", "survey.assist", "survey.manage", "welfare.manage"]);
  });
});

describe("what a Delegated HR Officer can do on their own", () => {
  it("is what any signed-in person can do and nothing in HR", () => {
    expect([...ROLE_PERMISSIONS.HR_OFFICER].sort()).toEqual(["self.security", "self.view"]);
    for (const p of ["hr.view", "hr.manage", "hr.approve", "hr.configure", "welfare.manage", "survey.manage", "succession.manage"] as Permission[]) expect(can("HR_OFFICER", p), p).toBe(false);
  });
});

describe("a grant that is live", () => {
  const today = "2026-11-11";
  it("is one not revoked and not past its end date (the end date itself still counts)", () => {
    const g = (over: Record<string, unknown>) => ({ function: "WELFARE" as const, endsOn: null as string | null, revokedAt: null as string | null, ...over });
    expect(liveFunctions([g({})], today)).toEqual(["WELFARE"]);
    expect(liveFunctions([g({ endsOn: "2026-11-11" })], today)).toEqual(["WELFARE"]);
    expect(liveFunctions([g({ endsOn: "2026-11-10" })], today)).toEqual([]);
    expect(liveFunctions([g({ revokedAt: "2026-11-01" })], today)).toEqual([]);
    expect(liveFunctions([g({}), g({ function: "SURVEYS" })], today).sort()).toEqual(["SURVEYS", "WELFARE"]);
  });
});

describe("whether this person may do this", () => {
  it("lets an officer do only what a live grant opens", () => {
    expect(canCtx(ctx("HR_OFFICER", ["welfare.manage"]), "welfare.manage")).toBe(true);
    expect(canCtx(ctx("HR_OFFICER", ["welfare.manage"]), "survey.manage")).toBe(false);
    expect(canCtx(ctx("HR_OFFICER", []), "welfare.manage")).toBe(false);
    expect(canCtx(ctx("HR_OFFICER"), "welfare.manage")).toBe(false);
  });
  it("never lets a grant open anything but the four functions, even if one were tampered with", () => {
    expect(canCtx(ctx("HR_OFFICER", ["hr.view" as Permission, "hr.manage" as Permission]), "hr.view")).toBe(false);
    expect(canCtx(ctx("HR_OFFICER", ["payroll.approve" as Permission]), "payroll.approve")).toBe(false);
  });
  it("ignores grants for anyone who is not a Delegated HR Officer, and leaves every other role as it was", () => {
    expect(canCtx(ctx("EMPLOYEE", ["welfare.manage"]), "welfare.manage")).toBe(false);
    expect(canCtx(ctx("COMPANY_ADMIN", ["welfare.manage"]), "welfare.manage")).toBe(false);
    for (const p of ASSIGNABLE_PERMISSIONS) expect(canCtx(ctx("HR_ADMIN"), p), p).toBe(true);
    for (const r of Object.keys(ROLE_PERMISSIONS) as Role[]) for (const p of ROLE_PERMISSIONS[r]) expect(canCtx(ctx(r), p), `${r} ${p}`).toBe(true);
  });
});

describe("which functions nobody holds", () => {
  it("is all four when there is no HR administrator and no live grant", () => {
    expect(unheldFunctions([])).toEqual(["WELFARE", "SURVEYS", "SURVEY_ASSIST", "SUCCESSION"]);
    expect(unheldFunctions([{ role: "COMPANY_ADMIN", functions: [] }, { role: "EMPLOYEE", functions: [] }])).toHaveLength(4);
  });
  it("counts an HR administrator as holding all four, and an officer as holding only their live functions", () => {
    expect(unheldFunctions([{ role: "HR_ADMIN", functions: [] }])).toEqual([]);
    expect(unheldFunctions([{ role: "HR_OFFICER", functions: ["WELFARE", "SURVEYS"] }])).toEqual(["SURVEY_ASSIST", "SUCCESSION"]);
    expect(unheldFunctions([{ role: "EMPLOYEE", functions: ["WELFARE"] }])).toHaveLength(4);
  });
});

describe("an external officer's access", () => {
  it("ends after the end date (the day itself still works), and never for someone with no end date", () => {
    expect(accessEnded("2026-11-10", "2026-11-11")).toBe(true);
    expect(accessEnded("2026-11-11", "2026-11-11")).toBe(false);
    expect(accessEnded(null, "2030-01-01")).toBe(false);
  });
});
