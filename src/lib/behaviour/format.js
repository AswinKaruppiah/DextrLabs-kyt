const DAYS_PER_MONTH = 365.25 / 12;

/** Wallet age for people: "less than a day", "45 days", "3 months", "1 year", "2 years 3 months". */
export function formatAge(days) {
  if (days === null || days === undefined) return null;
  if (days < 1) return "less than a day";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const totalMonths = Math.round(days / DAYS_PER_MONTH);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  return [years && `${years} year${years === 1 ? "" : "s"}`, months && `${months} month${months === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" ");
}
