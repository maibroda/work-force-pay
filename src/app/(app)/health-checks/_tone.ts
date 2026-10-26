export const CHECK_STATUS_LABEL = { IN_PROGRESS: "In progress", IN_REVIEW: "In review", ISSUED: "Issued", WITHDRAWN: "Withdrawn" } as const;
export const CHECK_STATUS_TONE = { IN_PROGRESS: "blue", IN_REVIEW: "amber", ISSUED: "green", WITHDRAWN: "gray" } as const;
export const RESPONSE_TONE = { NOT_ASSESSED: "gray", IN_PLACE: "green", PARTLY: "amber", NOT_SEEN: "red", NOT_APPLICABLE: "gray" } as const;
export const SEVERITY_TONE = { HIGH: "red", MEDIUM: "amber", LOW: "blue", OBSERVATION: "gray" } as const;
