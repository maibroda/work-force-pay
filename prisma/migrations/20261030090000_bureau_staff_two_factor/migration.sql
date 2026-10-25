-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "staffTwoFactorFrom" DATE;


-- A bureau always has a start day for its staff's two-factor sign-in: set when it becomes a bureau (14 days' notice), never removed, and only ever
-- brought forward. This holds whichever way the row is written.
CREATE OR REPLACE FUNCTION org_staff_two_factor_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."isBureau" AND NEW."staffTwoFactorFrom" IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD."staffTwoFactorFrom" IS NOT NULL THEN
      RAISE EXCEPTION 'Two-factor sign-in for a bureau''s staff cannot be switched off.';
    END IF;
    NEW."staffTwoFactorFrom" := CURRENT_DATE + 14;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."staffTwoFactorFrom" IS NOT NULL AND NEW."staffTwoFactorFrom" > OLD."staffTwoFactorFrom" THEN
    RAISE EXCEPTION 'The start day for a bureau''s staff two-factor sign-in can only be brought forward, not put back.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_staff_two_factor_guard BEFORE INSERT OR UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION org_staff_two_factor_guard();

-- bureaus that already exist get the same 14 days' notice
UPDATE "Organization" SET "staffTwoFactorFrom" = CURRENT_DATE + 14 WHERE "isBureau" AND "staffTwoFactorFrom" IS NULL;
