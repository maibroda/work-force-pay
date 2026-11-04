-- The software price book (docs/plans/module-entitlements-e4.md, step E4b): dated, two-person-verified versions of what each module costs. Tables only, EMPTY: no amount is in this file; every price is entered by the founder through the screen.


-- CreateTable
CREATE TABLE "SoftwarePriceBook" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "effectiveFrom" DATE NOT NULL,
    "minimumMonthly" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "SoftwarePriceBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwarePriceLine" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "SoftwarePriceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoftwarePriceBook_currency_effectiveFrom_key" ON "SoftwarePriceBook"("currency", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "SoftwarePriceLine_bookId_moduleKey_key" ON "SoftwarePriceLine"("bookId", "moduleKey");

-- AddForeignKey
ALTER TABLE "SoftwarePriceLine" ADD CONSTRAINT "SoftwarePriceLine_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "SoftwarePriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A verifier is never the maker (two people), checked by the database as well as by the application.
ALTER TABLE "SoftwarePriceBook" ADD CONSTRAINT "SoftwarePriceBook_verifier_not_maker" CHECK ("verifiedByUserId" IS NULL OR "verifiedByUserId" <> "createdByUserId");

-- Once a version has been verified it is a record of what was charged and can never be changed or deleted by anyone, the application included.
-- A draft may be edited, deleted, and verified (which is the one update a draft allows).
CREATE FUNCTION wfp_price_book_protect() RETURNS trigger AS $$
BEGIN
  IF OLD."verifiedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A verified price book cannot be changed or deleted; add a new version from a later date.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_price_book_protected
  BEFORE UPDATE OR DELETE ON "SoftwarePriceBook"
  FOR EACH ROW EXECUTE FUNCTION wfp_price_book_protect();

-- The prices in a version are fixed the moment the version is verified: no line can be added, changed or removed under a verified version.
CREATE FUNCTION wfp_price_line_protect() RETURNS trigger AS $$
DECLARE
  verified timestamp;
BEGIN
  SELECT "verifiedAt" INTO verified FROM "SoftwarePriceBook" WHERE "id" = COALESCE(NEW."bookId", OLD."bookId");
  IF verified IS NOT NULL THEN
    RAISE EXCEPTION 'The prices in a verified price book cannot be changed; add a new version from a later date.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_price_line_protected
  BEFORE INSERT OR UPDATE OR DELETE ON "SoftwarePriceLine"
  FOR EACH ROW EXECUTE FUNCTION wfp_price_line_protect();
