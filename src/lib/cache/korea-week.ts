const SEOUL_TIME_ZONE = "Asia/Seoul";

function getSeoulDate(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  ));
}

export function getKoreaMondayKey(value: Date | string = new Date()): string {
  const date = getSeoulDate(typeof value === "string" ? new Date(value) : value);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function isKoreaMonday(value: Date | string = new Date()): boolean {
  const date = getSeoulDate(typeof value === "string" ? new Date(value) : value);
  return date.getUTCDay() === 1;
}

export function isSameKoreaWeek(value: Date | string): boolean {
  return getKoreaMondayKey(value) === getKoreaMondayKey();
}
