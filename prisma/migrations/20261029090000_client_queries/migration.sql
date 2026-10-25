-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateTable
CREATE TABLE "ClientQuery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "raisedBy" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientQueryMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientQueryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientQuery_organizationId_status_idx" ON "ClientQuery"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientQuery_organizationId_number_key" ON "ClientQuery"("organizationId", "number");

-- CreateIndex
CREATE INDEX "ClientQueryMessage_queryId_createdAt_idx" ON "ClientQueryMessage"("queryId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientQuery" ADD CONSTRAINT "ClientQuery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQueryMessage" ADD CONSTRAINT "ClientQueryMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQueryMessage" ADD CONSTRAINT "ClientQueryMessage_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "ClientQuery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "ClientQuery" ADD CONSTRAINT "ClientQuery_closed_recorded" CHECK ("status" <> 'CLOSED' OR ("closedAt" IS NOT NULL AND "closedBy" IS NOT NULL));
ALTER TABLE "ClientQueryMessage" ADD CONSTRAINT "ClientQueryMessage_side" CHECK ("side" IN ('CLIENT', 'BUREAU') AND length(btrim("body")) >= 2);

-- A message is a record of what was said. It is never changed or removed, and nothing is added to a closed query.
CREATE OR REPLACE FUNCTION wfp_guard_query_messages() RETURNS trigger AS $$
DECLARE st "QueryStatus";
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'A query message cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT status INTO st FROM "ClientQuery" WHERE id = NEW."queryId";
  IF st = 'CLOSED' THEN
    RAISE EXCEPTION 'This query is closed; raise a new one.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_query_message_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "ClientQueryMessage"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_query_messages();
