// Shared constants for the dispute-risk model. These were previously
// duplicated across the dashboard summary, the daily brief email, the SQL
// expiring-filter, and the frontend insights page — drift between any two
// would silently produce different "expiring" counts or different exposure
// dollars on the same data. Single source of truth here.

// Fraction of the claim amount we typically pay the vendor up front and have
// to recover if the dispute fails. Multiply (1 + this) by claim totals to get
// approximate exposure.
export const VENDOR_PREPAY_RATE = 0.70;

// Filing-deadline windows, in calendar days, after weekend deadlines have
// been shifted back to the prior Friday.
//   SOON   — broadest "deadline closing" window; powers the dashboard
//            "Expiring" list and the `?expiring=soon` filter URL.
//   URGENT — narrower band for "needs filing now"; powers the red urgent
//            badge and the `?expiring=urgent` filter URL.
export const SOON_DAYS = 10;
export const URGENT_DAYS = 3;
