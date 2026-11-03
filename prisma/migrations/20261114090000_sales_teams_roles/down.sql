-- Reverses migration.sql as far as PostgreSQL allows: the two team tables are dropped (the teams are lost). The three role values (SALES_REP, SALES_MANAGER, ACCOUNT_MANAGER) stay
-- in the Role list because a value cannot be removed from an enumerated type; they are unused once no user holds them. It refuses to run while any user holds one of them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "role"::text IN ('SALES_REP', 'SALES_MANAGER', 'ACCOUNT_MANAGER')) THEN
    RAISE EXCEPTION 'Some users still hold SALES_REP, SALES_MANAGER or ACCOUNT_MANAGER. Give them another role first.';
  END IF;
END
$$;
DROP TABLE "CrmTeamMember";
DROP TABLE "CrmTeam";
