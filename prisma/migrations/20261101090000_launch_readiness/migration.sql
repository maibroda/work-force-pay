-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchCheck" (
    "id" TEXT NOT NULL,
    "bureauOrganizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchCheck_bureauOrganizationId_key_key" ON "LaunchCheck"("bureauOrganizationId", "key");

-- AddForeignKey
ALTER TABLE "LaunchCheck" ADD CONSTRAINT "LaunchCheck_bureauOrganizationId_fkey" FOREIGN KEY ("bureauOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A confirmation says what was done: no empty ticks.
ALTER TABLE "LaunchCheck" ADD CONSTRAINT "LaunchCheck_note_says_something" CHECK (length(btrim("note")) >= 10);
