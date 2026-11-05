/**
 * Pension fund administrators (PFAs). Each company keeps its own list (Settings → Pension fund administrators), managed by the company administrator and the HR manager, and an employee's
 * PFA is chosen from it. These nine are the list the employee form used to offer; every company starts with them (new companies when they are created, existing ones through the migration
 * 20261121090000_pfa_register), and can then add to the list, correct a name, record a PenCom number, or switch one off.
 */
export const DEFAULT_PFAS = [
  "Stanbic IBTC Pension Managers",
  "Access ARM Pensions",
  "Leadway Pensure PFA",
  "Premium Pension Ltd",
  "Crusader Sterling Pensions",
  "Fidelity Pension Managers",
  "Trustfund Pensions",
  "NLPC Pension Fund Administrators",
  "Tangerine APT Pensions",
] as const;

export const PFA_NAME_MAX = 80;
export const PFA_PENCOM_MAX = 40;

/** Two spellings of a PFA name are the same PFA if they differ only in capitals or spacing at the ends or between words. */
export const pfaKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
