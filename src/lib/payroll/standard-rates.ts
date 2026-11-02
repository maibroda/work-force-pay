/**
 * The standard rate of the VOLUNTARY NHF (National Housing Fund) contribution, as a percentage of basic pay: 2.5. It is the founder's rule, and the value in his
 * golden dataset (`tests/golden/golden_parameters.csv`, "nhf_rate_on_basic") and PAYE seed file; the tax adviser still confirms it. It is the shipped rate of the
 * payroll rule, and a payroll rule version can change it. It is taken only from employees who have chosen to contribute and is remitted by the end of the month.
 * Never read this at calculation time: the payroll rule's own setting is what decides.
 */
export const NHF_STANDARD_RATE_PCT = 2.5;
