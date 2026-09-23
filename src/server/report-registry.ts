import type { Ctx } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { d, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { listAudit } from "@/server/services/audit";
import { listArrears, listDeductions, listOvertime } from "@/server/services/inputs";
import { employeeLocationHistory, listMovements, listWorkRegister } from "@/server/services/operations";
import {
  bankSchedule,
  beatReconciliation,
  documentsReport,
  EMPLOYER_COST_FIELDS,
  employerCostSchedule,
  payeSchedule,
  payrollByClientAndBeat,
  payrollRegister,
  pensionSchedule,
  resolveRun,
  trainingReport,
  type EmployerCostField,
} from "@/server/services/reports";

export type Col = { key: string; label: string; money?: boolean; num?: boolean };
export interface Report {
  title: string;
  description: string;
  usesRun: boolean;
  filters: Array<"client" | "beat" | "dateRange" | "employee" | "month">;
  columns: Col[];
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, number>;
  runLabel?: string;
}

export const REPORT_TYPES = [
  "payroll-register",
  "payslips",
  "work-register",
  "staff-movement",
  "overtime",
  "arrears",
  "deductions",
  "pension",
  "paye",
  "bank",
  "itf",
  "nsitf",
  "nhf-medical",
  "insurance",
  "uniform-kits",
  "recruitment-training",
  "leave-reliever",
  "outsourcing-leave-allowance",
  "client-beat",
  "beat-reconciliation",
  "location-history",
  "employee-documents",
  "employee-training",
  "audit",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Maps each employer-cost report slug to its PayrollAllocation field. */
const EMPLOYER_COST_REPORT_FIELDS: Partial<Record<ReportType, EmployerCostField>> = {
  itf: "itf",
  nsitf: "nsitf",
  "nhf-medical": "nhfMedical",
  insurance: "insurance",
  "uniform-kits": "uniformKits",
  "recruitment-training": "recruitmentTraining",
  "leave-reliever": "leaveReliever",
  "outsourcing-leave-allowance": "outsourcingLeaveAllowance",
};

const sumCols = (rows: Array<Record<string, unknown>>, cols: Col[]) =>
  Object.fromEntries(
    cols
      .filter((c) => c.money || c.num)
      .map((c) => [c.key, Math.round(rows.reduce((a, r) => a + num(r[c.key]), 0) * 100) / 100]),
  );

export async function buildReport(
  ctx: Ctx,
  type: ReportType,
  p: Record<string, string | undefined>,
): Promise<Report | null> {
  const run = await resolveRun(ctx, p.runId);
  const runLabel = run
    ? `${run.period.name} — ${run.type === "REGULAR" ? "Regular" : `Supplementary #${run.runNumber}`} (${run.status})`
    : undefined;
  const now = new Date();
  const from =
    p.from ??
    (run ? iso(run.period.startDate) : iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))));
  const to = p.to ?? (run ? iso(run.period.endDate) : iso(now));
  switch (type) {
    case "payroll-register": {
      const recs = run ? await payrollRegister(ctx, run.id, { clientId: p.clientId, beatId: p.beatId }) : [];
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "category", label: "Category" },
        { key: "clients", label: "Client(s)" },
        { key: "beats", label: "Beat(s)" },
        { key: "days", label: "Days", num: true },
        { key: "earnedGross", label: "Earned gross", money: true },
        { key: "overtime", label: "Overtime", money: true },
        { key: "arrears", label: "Arrears", money: true },
        { key: "other", label: "Other", money: true },
        { key: "totalEarnings", label: "Total earnings", money: true },
        { key: "paye", label: "PAYE", money: true },
        { key: "employeePension", label: "Pension (EE)", money: true },
        { key: "deductions", label: "Other deductions", money: true },
        { key: "netPay", label: "Net pay", money: true },
        { key: "employerPension", label: "Pension (ER)", money: true },
        { key: "employerCost", label: "Employer cost", money: true },
      ];
      const rows = recs.map((r) => ({
        employeeNumber: r.employeeNumber,
        employeeName: r.employeeName,
        category: r.categoryName,
        clients: [...new Set(r.allocations.map((a) => a.client?.name ?? "Head Office"))].join("; "),
        beats: [...new Set(r.allocations.map((a) => a.beat?.name ?? "Head Office"))].join("; "),
        days: num(r.daysWorked),
        earnedGross: num(r.earnedGross),
        overtime: num(r.overtimeAmount),
        arrears: num(r.arrearsAmount),
        other: num(r.otherEarnings),
        totalEarnings: num(r.totalEarnings),
        paye: num(r.paye),
        employeePension: num(r.employeePension),
        deductions: num(r.otherDeductions),
        netPay: num(r.netPay),
        employerPension: num(r.employerPension),
        employerCost: num(r.employerCost),
      }));
      return {
        title: "Payroll register",
        description:
          "Filter by client and beat — employees who worked at the selected client/beat during the period are included.",
        usesRun: true,
        filters: ["client", "beat"],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "payslips": {
      const recs = run
        ? await db.payrollRecord.findMany({
            where: { organizationId: ctx.orgId, runId: run.id },
            orderBy: { employeeNumber: "asc" },
          })
        : [];
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "locations", label: "Locations worked" },
        { key: "netPay", label: "Net pay", money: true },
        { key: "link", label: "Payslip" },
      ];
      const rows = recs.map((r) => ({
        employeeNumber: r.employeeNumber,
        employeeName: r.employeeName,
        locations: (r.locations as Array<{ beatName: string }>).map((l) => l.beatName).join(" → "),
        netPay: num(r.netPay),
        link: `/payslips/${r.id}`,
      }));
      return {
        title: "Payslips",
        description:
          "Open any payslip to print or save as PDF. Every payslip lists all locations worked in the period.",
        usesRun: true,
        filters: [],
        columns,
        rows,
        runLabel,
      };
    }
    case "work-register": {
      const recs = await listWorkRegister(ctx, {
        from,
        to,
        beatId: p.beatId,
        clientId: p.clientId,
        employeeId: p.employeeId,
        take: 5000,
      });
      const columns: Col[] = [
        { key: "date", label: "Date" },
        { key: "employeeNumber", label: "Emp. No." },
        { key: "name", label: "Name" },
        { key: "client", label: "Client" },
        { key: "contract", label: "Contract" },
        { key: "beat", label: "Beat" },
        { key: "category", label: "Category" },
        { key: "shift", label: "Shift" },
        { key: "status", label: "Attendance" },
        { key: "hours", label: "Hours", num: true },
        { key: "ot", label: "OT hours", num: true },
        { key: "supervisor", label: "Supervisor" },
        { key: "remarks", label: "Remarks" },
        { key: "recordedBy", label: "Recorded by" },
        { key: "timestamp", label: "Timestamp" },
        { key: "exception", label: "Exception" },
      ];
      const rows = recs.map((r) => ({
        date: iso(r.date),
        employeeNumber: r.employee.employeeNumber,
        name: fullName(r.employee),
        client: r.client.name,
        contract: r.contract.contractNumber,
        beat: r.beat.name,
        category: r.category.name,
        shift: r.shift,
        status: r.attendanceStatus,
        hours: num(r.hoursWorked),
        ot: num(r.overtimeHours),
        supervisor: r.supervisor ?? "",
        remarks: r.remarks ?? "",
        recordedBy: r.recordedBy,
        timestamp: r.updatedAt.toISOString().slice(0, 16).replace("T", " "),
        exception: r.locationMismatch && !r.mismatchResolved ? "LOCATION MISMATCH" : "",
      }));
      return {
        title: "Work register",
        description: "Where each employee worked, per day, per location.",
        usesRun: false,
        filters: ["dateRange", "client", "beat", "employee"],
        columns,
        rows,
      };
    }
    case "staff-movement": {
      const recs = await listMovements(ctx, {});
      const columns: Col[] = [
        { key: "effective", label: "Effective" },
        { key: "end", label: "End" },
        { key: "employeeNumber", label: "Emp. No." },
        { key: "name", label: "Name" },
        { key: "type", label: "Type" },
        { key: "from", label: "Previous client — beat" },
        { key: "to", label: "New client — beat" },
        { key: "reason", label: "Reason" },
        { key: "approvedBy", label: "Approved by" },
        { key: "status", label: "Status" },
      ];
      const rows = recs
        .filter((m) => iso(m.effectiveDate) >= from && iso(m.effectiveDate) <= to)
        .map((m) => ({
          effective: iso(m.effectiveDate),
          end: m.endDate ? iso(m.endDate) : "",
          employeeNumber: m.employee.employeeNumber,
          name: fullName(m.employee),
          type: m.movementType,
          from: `${m.fromClient?.name ?? "—"} — ${m.fromBeat?.name ?? "—"}`,
          to: `${m.toClient.name} — ${m.toBeat.name}`,
          reason: m.reason,
          approvedBy: m.approvedBy ?? "",
          status: m.status,
        }));
      return {
        title: "Staff movement report",
        description: "All movements effective in the date range.",
        usesRun: false,
        filters: ["dateRange"],
        columns,
        rows,
      };
    }
    case "overtime": {
      const recs = await listOvertime(ctx, run?.periodId);
      const columns: Col[] = [
        { key: "date", label: "Date" },
        { key: "employeeNumber", label: "Emp. No." },
        { key: "name", label: "Name" },
        { key: "client", label: "Client" },
        { key: "beat", label: "Beat" },
        { key: "hours", label: "Hours", num: true },
        { key: "rate", label: "Rate", money: true },
        { key: "amount", label: "Amount", money: true },
        { key: "ref", label: "Approval ref." },
        { key: "status", label: "Status" },
      ];
      const rows = recs
        .filter((r) => (!p.clientId || r.clientId === p.clientId) && (!p.beatId || r.beatId === p.beatId))
        .map((r) => ({
          date: iso(r.date),
          employeeNumber: r.employee.employeeNumber,
          name: fullName(r.employee),
          client: r.client.name,
          beat: r.beat.name,
          hours: num(r.hours),
          rate: num(r.rate),
          amount: num(r.amount),
          ref: r.approvalReference ?? "",
          status: r.status,
        }));
      return {
        title: "Overtime report",
        description: "Overtime for the selected run's period.",
        usesRun: true,
        filters: ["client", "beat"],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "arrears": {
      const recs = await listArrears(ctx);
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "name", label: "Name" },
        { key: "period", label: "Affected period" },
        { key: "type", label: "Type" },
        { key: "original", label: "Original", money: true },
        { key: "corrected", label: "Corrected", money: true },
        { key: "gross", label: "Gross impact", money: true },
        { key: "tax", label: "Tax impact", money: true },
        { key: "pension", label: "Pension impact", money: true },
        { key: "net", label: "Net impact", money: true },
        { key: "processed", label: "Processed in" },
        { key: "status", label: "Status" },
      ];
      const rows = recs.map((a) => ({
        employeeNumber: a.employee.employeeNumber,
        name: fullName(a.employee),
        period: a.originalPeriod.name,
        type: a.arrearsType,
        original: num(a.originalAmount),
        corrected: num(a.correctedAmount),
        gross: num(a.grossImpact),
        tax: num(a.taxImpact),
        pension: num(a.pensionImpact),
        net: num(a.netImpact),
        processed: a.processedPeriod?.name ?? "",
        status: a.status,
      }));
      return {
        title: "Arrears report",
        description: "All arrears requests and their impact.",
        usesRun: false,
        filters: [],
        columns,
        rows,
        totals: sumCols(rows, columns),
      };
    }
    case "deductions": {
      const recs = await listDeductions(ctx, run?.periodId);
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "name", label: "Name" },
        { key: "type", label: "Type" },
        { key: "amount", label: "Amount", money: true },
        { key: "reason", label: "Reason" },
        { key: "authority", label: "Authority" },
        { key: "approvedBy", label: "Approved by" },
        { key: "status", label: "Status" },
      ];
      const rows = recs.map((x) => ({
        employeeNumber: x.employee.employeeNumber,
        name: fullName(x.employee),
        type: x.deductionType,
        amount: num(x.amount),
        reason: x.reason,
        authority: x.authorityReference,
        approvedBy: x.approvedBy ?? "",
        status: x.status,
      }));
      return {
        title: "Deductions report",
        description: "Penalties, loans, advances and recoveries for the selected run's period.",
        usesRun: true,
        filters: [],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "pension": {
      const rows = run ? await pensionSchedule(ctx, run.id) : [];
      const columns: Col[] = [
        { key: "pfa", label: "PFA" },
        { key: "pensionPin", label: "Pension PIN" },
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "pensionBase", label: "Pensionable (B+H+T)", money: true },
        { key: "employeePension", label: "Employee 8%", money: true },
        { key: "employerPension", label: "Employer 10%", money: true },
        { key: "total", label: "Total", money: true },
      ];
      return {
        title: "Pension schedule",
        description: "For remittance to PFAs — employer contribution computed automatically.",
        usesRun: true,
        filters: [],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "paye": {
      const rows = run ? await payeSchedule(ctx, run.id) : [];
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "taxId", label: "Tax ID" },
        { key: "totalEarnings", label: "Total earnings", money: true },
        { key: "taxableIncome", label: "Taxable income", money: true },
        { key: "paye", label: "PAYE", money: true },
        { key: "taxRuleVersion", label: "Rule version" },
      ];
      return {
        title: "PAYE schedule",
        description: "PAYE deducted per employee, with the tax-rule version used.",
        usesRun: true,
        filters: [],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "bank": {
      const rows = run ? await bankSchedule(ctx, run.id) : [];
      const columns: Col[] = [
        { key: "bankName", label: "Bank" },
        { key: "accountNumber", label: "Account number" },
        { key: "accountName", label: "Account name" },
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "netPay", label: "Net pay", money: true },
      ];
      return {
        title: "Bank payment schedule",
        description: "Net pay per employee grouped by bank.",
        usesRun: true,
        filters: [],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "itf":
    case "nsitf":
    case "nhf-medical":
    case "insurance":
    case "uniform-kits":
    case "recruitment-training":
    case "leave-reliever":
    case "outsourcing-leave-allowance": {
      const field = EMPLOYER_COST_REPORT_FIELDS[type]!;
      const meta = EMPLOYER_COST_FIELDS[field];
      const rows = run ? await employerCostSchedule(ctx, run.id, field) : [];
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "clients", label: "Client(s)" },
        { key: "amount", label: "Amount", money: true },
      ];
      return {
        title: `${meta.label} schedule`,
        description: `Per-employee ${meta.label.toLowerCase()} for the selected run — for remittance to ${meta.payee}.`,
        usesRun: true,
        filters: [],
        columns,
        rows,
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "client-beat": {
      const lines = run ? await payrollByClientAndBeat(ctx, run.id, p.clientId) : [];
      const columns: Col[] = [
        { key: "client", label: "Client" },
        { key: "beat", label: "Beat" },
        { key: "headcount", label: "Headcount", num: true },
        { key: "days", label: "Days", num: true },
        { key: "clientBilling", label: "Client billing (agreed rate)", money: true },
        { key: "gross", label: "Operatives' pay (70%)", money: true },
        { key: "overtime", label: "Overtime", money: true },
        { key: "managementShare", label: "Management share (30%)", money: true },
        { key: "employerPension", label: "Employer pension", money: true },
        { key: "margin", label: "Margin after pension", money: true },
        { key: "net", label: "Net paid", money: true },
      ];
      const rows: Array<Record<string, unknown>> = [];
      for (const c of lines) {
        for (const b of c.beats)
          rows.push({
            client: c.clientName,
            beat: `${b.beatName}`,
            headcount: b.headcount,
            days: b.days,
            clientBilling: b.clientBilling,
            gross: b.gross,
            overtime: b.overtime,
            managementShare: b.managementShare,
            employerPension: b.employerPension,
            margin: b.margin,
            net: b.net,
          });
        rows.push({
          client: c.clientName,
          beat: "— Client total —",
          headcount: c.headcount,
          days: c.days,
          clientBilling: c.clientBilling,
          gross: c.gross,
          overtime: c.overtime,
          managementShare: c.managementShare,
          employerPension: c.employerPension,
          margin: c.margin,
          net: c.net,
          _total: true,
        });
      }
      const body = rows.filter((r) => !r._total);
      return {
        title: "Payroll by client and beat",
        description:
          "Payroll allocated to every client and beat actually worked (multi-location employees are split by days). Agreed rate is shared 70:30.",
        usesRun: true,
        filters: ["client"],
        columns,
        rows,
        totals: sumCols(body, columns),
        runLabel,
      };
    }
    case "beat-reconciliation": {
      const rows = run ? await beatReconciliation(ctx, run.id) : [];
      const columns: Col[] = [
        { key: "clientName", label: "Client" },
        { key: "beatCode", label: "Code" },
        { key: "beatName", label: "Beat" },
        { key: "bidReference", label: "Bid" },
        { key: "approvedStrength", label: "Approved", num: true },
        { key: "actualStrength", label: "Actual", num: true },
        { key: "employeesWorked", label: "Worked", num: true },
        { key: "employeesPaid", label: "Paid", num: true },
        { key: "payrollAmount", label: "Payroll amount", money: true },
        { key: "flagText", label: "Flags" },
      ];
      return {
        title: "Beat payroll reconciliation",
        description:
          "Flags Approved ≠ Actual strength, Workers ≠ Payroll population, and payroll employees not assigned to the beat — preventing wrong-client / wrong-location payments.",
        usesRun: true,
        filters: [],
        columns,
        rows: rows.map((r) => ({ ...r, flagText: r.flags.join("; ") })),
        totals: sumCols(rows, columns),
        runLabel,
      };
    }
    case "location-history": {
      if (!p.employeeId)
        return {
          title: "Employee location history",
          description: "Select an employee.",
          usesRun: false,
          filters: ["employee", "dateRange"],
          columns: [],
          rows: [],
        };
      const ranges = await employeeLocationHistory(ctx, p.employeeId, d(from), d(to));
      const columns: Col[] = [
        { key: "from", label: "From" },
        { key: "to", label: "To" },
        { key: "clientName", label: "Client" },
        { key: "beatName", label: "Location (beat)" },
        { key: "days", label: "Paid days", num: true },
      ];
      return {
        title: "Employee location history",
        description: "Consecutive-day location ranges from the work register.",
        usesRun: false,
        filters: ["employee", "dateRange"],
        columns,
        rows: ranges as unknown as Array<Record<string, unknown>>,
        totals: sumCols(ranges as never, columns),
      };
    }
    case "employee-documents": {
      const rows = await documentsReport(ctx);
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "documentType", label: "Type" },
        { key: "documentNumber", label: "Number" },
        { key: "issueDate", label: "Issue date" },
        { key: "expiryDate", label: "Expiry date" },
        { key: "status", label: "Status" },
        { key: "fileReference", label: "Reference" },
      ];
      return {
        title: "Employee documents",
        description:
          "Every document on file, soonest-expiring first — ID, licenses, contracts, certificates.",
        usesRun: false,
        filters: [],
        columns,
        rows,
      };
    }
    case "employee-training": {
      const rows = await trainingReport(ctx);
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        { key: "courseName", label: "Course / certification" },
        { key: "provider", label: "Provider" },
        { key: "certificateNumber", label: "Certificate no." },
        { key: "issueDate", label: "Issue date" },
        { key: "expiryDate", label: "Expiry date" },
        { key: "status", label: "Status" },
      ];
      return {
        title: "Training & certifications",
        description:
          "Every training/certification on file, soonest-expiring first — compliance record for firearms licenses, first aid, tactical training, etc.",
        usesRun: false,
        filters: [],
        columns,
        rows,
      };
    }
    case "audit": {
      const recs = await listAudit(ctx, { q: p.q, entity: p.entity, take: 1000 });
      const columns: Col[] = [
        { key: "time", label: "Date / time" },
        { key: "user", label: "User" },
        { key: "action", label: "Action" },
        { key: "entity", label: "Entity" },
        { key: "entityId", label: "Entity ID" },
        { key: "reason", label: "Reason" },
        { key: "change", label: "Old → new" },
      ];
      const rows = recs.map((a) => ({
        time: a.createdAt.toISOString().replace("T", " ").slice(0, 19),
        user: a.userName,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId ?? "",
        reason: a.reason ?? "",
        change: `${a.oldValue ? JSON.stringify(a.oldValue).slice(0, 120) : ""}${a.newValue ? ` → ${JSON.stringify(a.newValue).slice(0, 160)}` : ""}`,
      }));
      return {
        title: "Audit report",
        description: "Every create/update/approval with user, time, old and new values.",
        usesRun: false,
        filters: [],
        columns,
        rows,
      };
    }
  }
}
