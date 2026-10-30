-- Sales Phase 5 (docs/crm/05-phase-5-plan.md): the handover of an accepted quote to Operations.
-- New tables only (nothing existing is changed): the handover, its sites and posts (the quote facts copied in, plus what Sales enters), a history of who submitted,
-- returned and accepted it, and the people designated to accept a handover for Operations. The database itself refuses to change an accepted handover, to
-- change the quote facts copied into one, to change a site or post once the handover is sent, or to change or delete its history.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmHandoverStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "CrmHandoverEventKind" AS ENUM ('CREATED', 'SUBMITTED', 'RETURNED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "CrmHandover" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "CrmHandoverStatus" NOT NULL DEFAULT 'DRAFT',
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "submittedRevision" INTEGER,
    "quoteNumber" TEXT NOT NULL,
    "quoteVersion" INTEGER NOT NULL,
    "monthlyBill" DECIMAL(16,2) NOT NULL,
    "validUntil" DATE,
    "scope" TEXT,
    "clientRequirements" TEXT,
    "startDate" DATE,
    "termMonths" INTEGER,
    "serviceLevels" JSONB NOT NULL DEFAULT '[]',
    "noSpecialSla" BOOLEAN NOT NULL DEFAULT false,
    "preparedBy" TEXT NOT NULL,
    "preparedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "submittedByUserId" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedBy" TEXT,
    "returnNote" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "acceptedByUserId" TEXT,
    "acceptanceNote" TEXT,
    "acceptedRevision" INTEGER,
    "clientId" TEXT,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmHandoverSite" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "state" TEXT,
    "lga" TEXT,
    "contactName" TEXT,
    "contactRole" TEXT,
    "contactPhoneE164" TEXT,
    "contactEmail" TEXT,
    "equipment" JSONB NOT NULL DEFAULT '[]',
    "noEquipment" BOOLEAN NOT NULL DEFAULT false,
    "beatId" TEXT,
    CONSTRAINT "CrmHandoverSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmHandoverPost" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "quoteLineId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "postLabel" TEXT,
    "shiftPattern" TEXT,
    "salaryStructureId" TEXT NOT NULL,
    "structureName" TEXT NOT NULL,
    "businessLine" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "requiredPersonnel" INTEGER NOT NULL,
    "billPerHead" DECIMAL(16,2) NOT NULL,
    "operativeSharePct" DECIMAL(5,2) NOT NULL,
    "categoryId" TEXT,
    CONSTRAINT "CrmHandoverPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmHandoverEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "kind" "CrmHandoverEventKind" NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmHandoverEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmHandoverAcceptor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "designatedBy" TEXT NOT NULL,
    "designatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedBy" TEXT,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "CrmHandoverAcceptor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmHandover_quoteId_key" ON "CrmHandover"("quoteId");

-- CreateIndex
CREATE INDEX "CrmHandover_organizationId_status_idx" ON "CrmHandover"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmHandover_organizationId_number_key" ON "CrmHandover"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CrmHandover_opportunityId_key" ON "CrmHandover"("opportunityId");

-- CreateIndex
CREATE INDEX "CrmHandoverSite_handoverId_sortOrder_idx" ON "CrmHandoverSite"("handoverId", "sortOrder");

-- CreateIndex
CREATE INDEX "CrmHandoverPost_handoverId_sortOrder_idx" ON "CrmHandoverPost"("handoverId", "sortOrder");

-- CreateIndex
CREATE INDEX "CrmHandoverEvent_handoverId_at_idx" ON "CrmHandoverEvent"("handoverId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "CrmHandoverAcceptor_organizationId_userId_key" ON "CrmHandoverAcceptor"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "CrmHandover" ADD CONSTRAINT "CrmHandover_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandover" ADD CONSTRAINT "CrmHandover_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandover" ADD CONSTRAINT "CrmHandover_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandoverSite" ADD CONSTRAINT "CrmHandoverSite_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "CrmHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandoverPost" ADD CONSTRAINT "CrmHandoverPost_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "CrmHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandoverPost" ADD CONSTRAINT "CrmHandoverPost_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CrmHandoverSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandoverEvent" ADD CONSTRAINT "CrmHandoverEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandoverEvent" ADD CONSTRAINT "CrmHandoverEvent_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "CrmHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHandoverAcceptor" ADD CONSTRAINT "CrmHandoverAcceptor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The handover: never deleted; frozen once accepted; the quote facts copied into it never change.
CREATE OR REPLACE FUNCTION crm_handover_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A handover cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'ACCEPTED' THEN
    RAISE EXCEPTION 'An accepted handover cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."opportunityId" IS DISTINCT FROM OLD."opportunityId"
     OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId" OR NEW."accountId" IS DISTINCT FROM OLD."accountId" OR NEW."quoteNumber" IS DISTINCT FROM OLD."quoteNumber"
     OR NEW."quoteVersion" IS DISTINCT FROM OLD."quoteVersion" OR NEW."monthlyBill" IS DISTINCT FROM OLD."monthlyBill" OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil" THEN
    RAISE EXCEPTION 'The quote facts copied into a handover cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmHandover_guard" BEFORE UPDATE OR DELETE ON "CrmHandover" FOR EACH ROW EXECUTE FUNCTION crm_handover_guard();

-- Sites and posts: never deleted; added only while the handover is a draft; changed only while it is a draft or returned. The facts copied from the quote never
-- change; a site's link to the site made on acceptance may be set once while the handover is being accepted.
CREATE OR REPLACE FUNCTION crm_handover_child_guard() RETURNS trigger AS $$
DECLARE
  hid TEXT;
  st TEXT;
  o JSONB;
  n JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A site or post of a handover cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status"::text INTO st FROM "CrmHandover" WHERE "id" = NEW."handoverId";
  IF TG_OP = 'INSERT' THEN
    IF st IS NOT NULL AND st <> 'DRAFT' THEN
      RAISE EXCEPTION 'Sites and posts cannot be added to a handover that has been sent.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'CrmHandoverSite' THEN
    IF (n - 'beatId') = (o - 'beatId') AND OLD."beatId" IS NULL THEN RETURN NEW; END IF;
    IF st NOT IN ('DRAFT', 'RETURNED') THEN
      RAISE EXCEPTION 'A site of a handover that has been sent cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (n - 'address' - 'state' - 'lga' - 'contactName' - 'contactRole' - 'contactPhoneE164' - 'contactEmail' - 'equipment' - 'noEquipment') IS DISTINCT FROM
       (o - 'address' - 'state' - 'lga' - 'contactName' - 'contactRole' - 'contactPhoneE164' - 'contactEmail' - 'equipment' - 'noEquipment') THEN
      RAISE EXCEPTION 'The name and order of a handover site come from the quote and cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF st NOT IN ('DRAFT', 'RETURNED') THEN
      RAISE EXCEPTION 'A post of a handover that has been sent cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (n - 'categoryId') IS DISTINCT FROM (o - 'categoryId') THEN
      RAISE EXCEPTION 'The guards, shifts and bill rates of a handover come from the quote and cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmHandoverSite_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmHandoverSite" FOR EACH ROW EXECUTE FUNCTION crm_handover_child_guard();
CREATE TRIGGER "CrmHandoverPost_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmHandoverPost" FOR EACH ROW EXECUTE FUNCTION crm_handover_child_guard();

-- The history of a handover is never changed.
CREATE OR REPLACE FUNCTION crm_handover_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A handover history record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmHandoverEvent_immutable" BEFORE UPDATE OR DELETE ON "CrmHandoverEvent" FOR EACH ROW EXECUTE FUNCTION crm_handover_event_immutable();
