const SEOUL_TIME_ZONE = "Asia/Seoul";
const FIRST_DRAW_DATE = "2002-12-07";
const DAYS_PER_DRAW = 7;

function getSeoulParts(value: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).map((part) => [part.type, part.value]));
}

export function getLatestCompletedDrawDate(value: Date = new Date()): string {
  const parts = getSeoulParts(value);
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdays[parts.weekday];
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  let daysSinceSaturday = (weekday + 1) % DAYS_PER_DRAW;

  // Saturday's result is not considered complete until after the evening draw.
  if (weekday === 6 && Number(parts.hour) < 21) daysSinceSaturday += DAYS_PER_DRAW;

  date.setUTCDate(date.getUTCDate() - daysSinceSaturday);
  return date.toISOString().slice(0, 10);
}

export function getRoundForDrawDate(drawDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) return null;

  const drawTime = Date.parse(`${drawDate}T00:00:00Z`);
  const firstDrawTime = Date.parse(`${FIRST_DRAW_DATE}T00:00:00Z`);
  const elapsedDays = (drawTime - firstDrawTime) / (24 * 60 * 60 * 1000);

  if (!Number.isInteger(elapsedDays) || elapsedDays < 0 || elapsedDays % DAYS_PER_DRAW !== 0) return null;
  return elapsedDays / DAYS_PER_DRAW + 1;
}

export function getLatestCompletedDraw(value: Date = new Date()): { date: string; round: number } {
  const date = getLatestCompletedDrawDate(value);
  const round = getRoundForDrawDate(date);
  if (round === null) throw new Error("최신 로또 회차를 계산하지 못했습니다.");
  return { date, round };
}
