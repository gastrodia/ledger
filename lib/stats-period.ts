/** Calendar calculations use UTC day boundaries so DST cannot change the day count. */
const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date;
}

function isoDate(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function localCalendarDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = calendarDate(year, month - 1, day);
  return year > 0 && isoDate(date) === value ? date : null;
}

export interface StatsPeriod {
  startDate: string;
  endDate: string;
  endExclusive: string;
  previousStartDate: string;
  previousEndDate: string;
  previousEndExclusive: string;
  asOfDate: string;
  dailyEndExclusive: string;
  elapsedDays: number;
  totalDays: number;
  state: "past" | "current" | "future";
}

export function getStatsPeriod(mode: "month" | "year", value: string, asOf = localCalendarDate()): StatsPeriod | null {
  if (!(mode === "month" ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}$/).test(value)) return null;
  const [year, rawMonth] = value.split("-").map(Number);
  // Leave room for the previous and following calendar periods.
  if (year < 2 || year > 9998) return null;
  const today = parseDate(asOf);
  if (!today) return null;
  const month = mode === "month" ? rawMonth - 1 : 0;
  const start = calendarDate(year, month, 1);
  const end = calendarDate(mode === "year" ? year + 1 : year, mode === "year" ? 0 : month + 1, 1);
  const previous = calendarDate(mode === "year" ? year - 1 : year, mode === "year" ? 0 : month - 1, 1);
  const elapsedDays = Math.max(0, Math.min((end.getTime() - start.getTime()) / DAY_MS, (today.getTime() - start.getTime()) / DAY_MS + 1));
  return {
    startDate: isoDate(start),
    endDate: isoDate(new Date(end.getTime() - DAY_MS)),
    endExclusive: isoDate(end),
    previousStartDate: isoDate(previous),
    previousEndDate: isoDate(new Date(start.getTime() - DAY_MS)),
    previousEndExclusive: isoDate(start),
    asOfDate: asOf,
    dailyEndExclusive: isoDate(new Date(start.getTime() + elapsedDays * DAY_MS)),
    elapsedDays,
    totalDays: (end.getTime() - start.getTime()) / DAY_MS,
    state: today < start ? "future" : today >= end ? "past" : "current",
  };
}

export function statsDetailHref(period: Pick<StatsPeriod, "startDate" | "endDate">, type: "income" | "expense", dimension: "categoryId" | "memberId", id: string | null) {
  const params = new URLSearchParams({ startDate: period.startDate, endDate: period.endDate, type, [dimension]: id || "none" });
  return `/dashboard?${params.toString()}`;
}

export function describeAmountChange(current: number, previous: number) {
  if (current === previous) return "与上期持平";
  if (previous === 0) return "上期为 0，暂无可比比例";
  const percent = Math.abs((current - previous) / previous * 100).toFixed(1);
  return `较上期${current > previous ? "增加" : "减少"} ${percent}%`;
}
