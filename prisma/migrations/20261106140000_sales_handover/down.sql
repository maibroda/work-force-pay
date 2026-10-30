-- Reverses migration.sql. Every handover, with its sites, posts, history and the list of acceptors, is lost. Records already made from an accepted handover
-- (clients, contracts, rates, sites) are separate records and stay.
DROP TRIGGER "CrmHandoverEvent_immutable" ON "CrmHandoverEvent";
DROP TRIGGER "CrmHandoverPost_guard" ON "CrmHandoverPost";
DROP TRIGGER "CrmHandoverSite_guard" ON "CrmHandoverSite";
DROP TRIGGER "CrmHandover_guard" ON "CrmHandover";
DROP FUNCTION crm_handover_event_immutable();
DROP FUNCTION crm_handover_child_guard();
DROP FUNCTION crm_handover_guard();
DROP TABLE "CrmHandoverAcceptor";
DROP TABLE "CrmHandoverEvent";
DROP TABLE "CrmHandoverPost";
DROP TABLE "CrmHandoverSite";
DROP TABLE "CrmHandover";
DROP TYPE "CrmHandoverEventKind";
DROP TYPE "CrmHandoverStatus";
