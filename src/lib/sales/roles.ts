/**
 * Which roles count as a "sales manager" in the sales module: the people who can both change records and see more than their own. That is a role that sees everything (the company
 * administrator) or the team sales manager, whose reach is the teams they manage (decided in src/server/services/sales/access.ts).
 */
import { can, type Role } from "../auth/permissions";

export const isSalesManagerRole = (role: Role | string): boolean => can(role as Role, "sales.manage") && (can(role as Role, "sales.view.all") || role === "SALES_MANAGER");

/** The roles a company may give to someone who sells: they must be able to work records, and must not already see everything or manage a team. */
export const SALES_PERSON_ROLES: Role[] = ["SALES_REP", "ACCOUNT_MANAGER", "BUSINESS_DEV"];
