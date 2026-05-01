export const STATUSES = [
  "New",
  "Needs Review",
  "Needs Evidence",
  "Portal Queued",
  "Generating Email",
  "Ready to Review",
  "Awaiting Response",
  "On Hold",
  "Resolved",
  "Denied",
] as const;

export const OUTCOMES = [
  "Pending",
  "Approved",
  "Denied",
  "Partially Approved",
  "Non-Issue",
] as const;

export type ErrorTypeOption = {
  id: string;
  name: string;
  italic?: boolean;
};

export const ERROR_TYPES: readonly ErrorTypeOption[] = [
  { id: "unassigned", name: "Unassigned", italic: true },
  { id: "1", name: "Invoice Number Not in System" },
  { id: "2", name: "GPS Pickup Too Far from Residence" },
  { id: "3", name: "GPS Deviation Status" },
  { id: "4", name: "Time at Medical Facility Too Short" },
  { id: "5", name: "Time at Medical Facility Too Long" },
  { id: "6", name: "Attesting Too Soon" },
  { id: "7", name: "Trip Distance Mismatch" },
  { id: "8", name: "Driver Not Authorized" },
  { id: "9", name: "Vehicle Not Compliant" },
  { id: "10", name: "Documentation Missing" },
  { id: "11", name: "Pickup Address Mismatch" },
  { id: "12", name: "Drop-off Address Mismatch" },
];

export const DEADLINES = [
  { value: "all", label: "All deadlines" },
  { value: "soon", label: "Expiring soon (≤ 10 days)" },
  { value: "urgent", label: "Must file today" },
] as const;

export type SampleRow = {
  conf: string;
  serviceDate: string;
  client: string;
  status: typeof STATUSES[number];
  errorType: string;
  amount: string;
  deadline: "today" | "soon" | "ok";
};

export const SAMPLE_ROWS: SampleRow[] = [
  { conf: "14861355", serviceDate: "Mar 30, 2026", client: "UP499", status: "Needs Review", errorType: "Invoice Number Not in System", amount: "$30.05", deadline: "today" },
  { conf: "14859602", serviceDate: "Mar 30, 2026", client: "UN261", status: "Needs Review", errorType: "GPS Pickup Too Far from Residence", amount: "$101.73", deadline: "today" },
  { conf: "14859595", serviceDate: "Mar 30, 2026", client: "UN261", status: "Awaiting Response", errorType: "Attesting Too Soon", amount: "$106.71", deadline: "today" },
  { conf: "14893184", serviceDate: "Mar 30, 2026", client: "KS824", status: "Needs Evidence", errorType: "Time at Medical Facility Too Short", amount: "$66.38", deadline: "soon" },
  { conf: "14893183", serviceDate: "Mar 30, 2026", client: "KS824", status: "Needs Evidence", errorType: "Time at Medical Facility Too Long", amount: "$73.21", deadline: "soon" },
  { conf: "14861141", serviceDate: "Mar 30, 2026", client: "PQ727", status: "Portal Queued", errorType: "GPS Deviation Status", amount: "$47.93", deadline: "soon" },
  { conf: "14860540", serviceDate: "Mar 30, 2026", client: "PQ727", status: "Generating Email", errorType: "Trip Distance Mismatch", amount: "$55.01", deadline: "ok" },
  { conf: "14893848", serviceDate: "Mar 30, 2026", client: "XX633", status: "Ready to Review", errorType: "Driver Not Authorized", amount: "$64.39", deadline: "ok" },
  { conf: "14866207", serviceDate: "Mar 31, 2026", client: "BZ215", status: "On Hold", errorType: "Vehicle Not Compliant", amount: "$8.35", deadline: "ok" },
  { conf: "14866211", serviceDate: "Mar 31, 2026", client: "BZ215", status: "Resolved", errorType: "Documentation Missing", amount: "$8.35", deadline: "ok" },
  { conf: "14899027", serviceDate: "Mar 31, 2026", client: "TZ124", status: "Denied", errorType: "GPS Pickup Too Far from Residence", amount: "$52.61", deadline: "ok" },
  { conf: "14871298", serviceDate: "Mar 31, 2026", client: "ZY487", status: "Needs Review", errorType: "Pickup Address Mismatch", amount: "$44.99", deadline: "soon" },
];
