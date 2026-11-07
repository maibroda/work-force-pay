import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { CATEGORY_LABELS, DOCUMENT_CATEGORIES, STATUS_LABELS, type DocumentCategory, type DocumentStatus } from "@/lib/documents";
import { awaitingApproval, expiringDocuments, missingDocuments, searchDocuments } from "@/server/services/document-register";
import { fmtDate } from "@/lib/dates";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { RegisterRowActions } from "@/components/document-file-buttons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const VIEWS = [
  { key: "register", label: "All documents" },
  { key: "awaiting", label: "Awaiting approval" },
  { key: "expiring", label: "Expiring or expired" },
  { key: "missing", label: "Missing documents" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const PAGE_SIZE = 50;
const STATUS_CHOICES = ["PENDING", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "ARCHIVED"] as const;

type Row = Awaited<ReturnType<typeof searchDocuments>>["rows"][number];

function DocumentRows({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty>No documents match.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Employee</TH>
          <TH>Document</TH>
          <TH>Category</TH>
          <TH>Uploaded</TH>
          <TH>Expiry date</TH>
          <TH>Status</TH>
          <TH>Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} className={r.expired ? "bg-red-50/60" : ""}>
            <TD>
              <Link className="font-medium text-primary hover:underline" href={`/employees/${r.employeeId}?tab=documents`}>
                {r.employeeName}
              </Link>
              <div className="text-xs text-muted-foreground">{r.employeeNumber}</div>
            </TD>
            <TD className="max-w-xs whitespace-normal">
              {r.name}
              {r.versionCount > 1 && <span className="ml-1 text-xs text-muted-foreground">(version {r.versionCount})</span>}
            </TD>
            <TD className="text-xs">{CATEGORY_LABELS[r.category]}</TD>
            <TD className="text-xs">
              {fmtDate(r.uploadedAt)}
              <div className="text-muted-foreground">by {r.uploadedBy}</div>
            </TD>
            <TD className={r.expired ? "text-xs font-medium text-red-700" : "text-xs"}>{fmtDate(r.expiryDate)}</TD>
            <TD className="max-w-48 whitespace-normal">
              <StatusBadge status={r.status} />
              {r.status === "SUBMITTED" && <div className="mt-1 text-[11px] text-muted-foreground">Submitted {fmtDate(r.submittedAt)}</div>}
              {r.status === "UNDER_REVIEW" && <div className="mt-1 text-[11px] text-muted-foreground">Being reviewed by {r.reviewedBy}</div>}
            </TD>
            <TD className="min-w-56">
              <RegisterRowActions documentId={r.id} current={r.current} actions={r.actions} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function DocumentRegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("document.view");
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "register";
  const days = [30, 60, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const page = Math.max(Number(sp.page) || 1, 1);
  const tab = (k: string) => `/hr/documents?view=${k}`;
  return (
    <>
      <PageHeader
        title="Employee documents"
        description="Every electronic document in the company, in one place: search, see what is waiting for approval, what is about to expire, and who is still missing a required document. Identification and medical documents are shown only to people with that access. A required document counts only once it is approved."
      />
      <nav className="no-print mb-4 flex flex-wrap gap-1 border-b text-sm">
        {VIEWS.map((v) => (
          <Link key={v.key} href={tab(v.key)} className={view === v.key ? "border-b-2 border-primary px-3 py-2 font-medium" : "px-3 py-2 text-muted-foreground hover:text-foreground"}>
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "register" && <RegisterView sp={sp} page={page} ctx={ctx} />}

      {view === "awaiting" && <AwaitingView ctx={ctx} />}

      {view === "expiring" && (
        <>
          <div className="no-print mb-4 flex gap-1 text-sm">
            {[30, 60, 90].map((n) => (
              <Link key={n} href={`/hr/documents?view=expiring&days=${n}`} className={days === n ? "rounded-md border border-primary bg-primary/10 px-3 py-1 font-medium" : "rounded-md border px-3 py-1 text-muted-foreground hover:bg-accent"}>
                Next {n} days
              </Link>
            ))}
          </div>
          <ExpiringView ctx={ctx} days={days} />
        </>
      )}

      {view === "missing" && <MissingView ctx={ctx} />}
    </>
  );
}

type PageCtx = Awaited<ReturnType<typeof requirePage>>;

async function RegisterView({ sp, page, ctx }: { sp: Record<string, string | undefined>; page: number; ctx: PageCtx }) {
  const category = DOCUMENT_CATEGORIES.includes(sp.category as DocumentCategory) ? (sp.category as DocumentCategory) : undefined;
  const status = (STATUS_CHOICES as readonly string[]).includes(sp.status ?? "") ? (sp.status as DocumentStatus) : undefined;
  const { rows, total } = await searchDocuments(ctx, {
    q: sp.q,
    category,
    status,
    uploadedFrom: sp.uploadedFrom || undefined,
    uploadedTo: sp.uploadedTo || undefined,
    expiryFrom: sp.expiryFrom || undefined,
    expiryTo: sp.expiryTo || undefined,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "page") keep.set(k, v);
  const link = (p: number) => {
    const q = new URLSearchParams(keep);
    q.set("view", "register");
    q.set("page", String(p));
    return `/hr/documents?${q.toString()}`;
  };
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  return (
    <>
      <FilterBar action="/hr/documents">
        <input type="hidden" name="view" value="register" />
        <FilterField label="Employee name or number">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. Ada or EMP-0012" />
        </FilterField>
        <FilterField label="Category">
          <Select name="category" defaultValue={category ?? ""}>
            <option value="">All categories</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">Active (not archived)</option>
            {STATUS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Uploaded from">
          <Input type="date" name="uploadedFrom" defaultValue={sp.uploadedFrom ?? ""} />
        </FilterField>
        <FilterField label="Uploaded to">
          <Input type="date" name="uploadedTo" defaultValue={sp.uploadedTo ?? ""} />
        </FilterField>
        <FilterField label="Expires from">
          <Input type="date" name="expiryFrom" defaultValue={sp.expiryFrom ?? ""} />
        </FilterField>
        <FilterField label="Expires to">
          <Input type="date" name="expiryTo" defaultValue={sp.expiryTo ?? ""} />
        </FilterField>
      </FilterBar>
      <Section title={`${total} document${total === 1 ? "" : "s"}`} flush>
        <DocumentRows rows={rows} />
      </Section>
      {pages > 1 && (
        <p className="no-print mt-3 flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link className="text-primary hover:underline" href={link(page - 1)}>
              ← Previous
            </Link>
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="text-primary hover:underline" href={link(page + 1)}>
              Next →
            </Link>
          )}
        </p>
      )}
    </>
  );
}

async function AwaitingView({ ctx }: { ctx: PageCtx }) {
  const rows = await awaitingApproval(ctx);
  return (
    <Section
      title={`${rows.length} waiting for a decision`}
      description="Oldest first. Whoever uploaded or submitted a document cannot approve it; only the person who takes it for review can decide."
      flush
    >
      <DocumentRows rows={rows} />
    </Section>
  );
}

async function ExpiringView({ ctx, days }: { ctx: PageCtx; days: number }) {
  const rows = await expiringDocuments(ctx, days);
  const expired = rows.filter((r) => r.expired).length;
  return (
    <>
      <StatGrid cols={4}>
        <Stat label="Already expired" value={expired} tone={expired ? "red" : undefined} />
        <Stat label={`Expiring in ${days} days`} value={rows.length - expired} tone={rows.length - expired ? "amber" : undefined} />
      </StatGrid>
      <Section title="Soonest first" description="Approved documents with an expiry date. Ask for a renewal, then replace the document on the employee's Documents tab." flush>
        <DocumentRows rows={rows} />
      </Section>
    </>
  );
}

async function MissingView({ ctx }: { ctx: PageCtx }) {
  const { summary, rows } = await missingDocuments(ctx);
  if (!summary.length)
    return (
      <Section title="No required documents set">
        <p className="text-sm text-muted-foreground">
          Nothing is required yet, so nobody is shown as missing a document. Choose what the company requires under Document types (Required documents).
        </p>
      </Section>
    );
  return (
    <>
      <Section title="By required document" flush>
        <Table>
          <THead>
            <TR>
              <TH>Document</TH>
              <TH>Employees it applies to</TH>
              <TH>Approved on file</TH>
              <TH>Missing or not approved</TH>
            </TR>
          </THead>
          <TBody>
            {summary.map((s) => (
              <TR key={s.typeId}>
                <TD>{s.typeName}</TD>
                <TD>{s.required}</TD>
                <TD>{s.present}</TD>
                <TD>{s.missing ? <Badge tone="amber">{s.missing}</Badge> : <Badge tone="green">0</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title={`${rows.length} to chase`} description="Active employees and those on leave. A document that is submitted but not yet approved does not count." flush>
        {rows.length === 0 ? (
          <Empty>Everyone has every required document approved.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Document</TH>
                <TH>Where it stands</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={`${r.employeeId}|${r.typeId}`}>
                  <TD>
                    <Link className="font-medium text-primary hover:underline" href={`/employees/${r.employeeId}?tab=documents`}>
                      {r.employeeName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.employeeNumber}</div>
                  </TD>
                  <TD>{r.typeName}</TD>
                  <TD>
                    <Badge tone={r.state === "MISSING" || r.state === "REJECTED" || r.state === "EXPIRED" ? "red" : "amber"}>{r.stateLabel}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
