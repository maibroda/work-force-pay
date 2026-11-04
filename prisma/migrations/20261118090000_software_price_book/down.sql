-- Reverses migration.sql. Every price book version and its prices are lost (they were entered by hand: take a copy first if any has been used for a real quote).
DROP TRIGGER wfp_price_line_protected ON "SoftwarePriceLine";
DROP TRIGGER wfp_price_book_protected ON "SoftwarePriceBook";
DROP TABLE "SoftwarePriceLine";
DROP TABLE "SoftwarePriceBook";
DROP FUNCTION wfp_price_line_protect();
DROP FUNCTION wfp_price_book_protect();
