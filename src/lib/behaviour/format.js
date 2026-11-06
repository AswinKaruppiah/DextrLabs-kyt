const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Wallet age for people: "less than a day", "45 days", "3 months", "1 year", "2 years 3 months".
 * Whole months only, never rounded up: 1 year 11.5 months reads "1 year 11 months", not "2 years".
 * (The extra day keeps exactly 365 days at "1 year", as a month is 30.44 days on average.)
 */
export function formatAge(days) {
  if (days === null || days === undefined) return null;
  if (days < 1) return "less than a day";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const totalMonths = Math.floor((days + 1) / DAYS_PER_MONTH);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  return [years && `${years} year${years === 1 ? "" : "s"}`, months && `${months} month${months === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" ");
}

/** "1 wallet", "1,282 wallets": a count with its noun, singular for exactly one. */
export const countOf = (n, noun) => `${(n ?? 0).toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
