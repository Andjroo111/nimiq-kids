// Calendar day math, shared by the routes that serve day ranges and the repos
// that count them. Pure string math on 'YYYY-MM-DD' via UTC, so nothing here can
// pick up a local-timezone shift. Turning a wall clock into a day is a different
// job and lives in repo-routines.localDay().

/** 'YYYY-MM-DD' + n -> 'YYYY-MM-DD', over month and year ends. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' -> the Monday of that ISO week. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return addDays(day, -dow);
}

/** The seven days of the week starting at `weekStart` (a Monday). */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * 'YYYY-MM' -> every day of the calendar grid for that month: WHOLE Mon-first
 * weeks covering the 1st through the last, so the grid is always a clean 7xN
 * and the kid's calendar never has a ragged first or last row. Leading/trailing
 * days belong to the neighbouring months and the client dims them.
 */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDate = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // day 0 of next month
  const firstWeek = mondayOf(`${y}-${pad(m!)}-01`);
  const lastWeek = mondayOf(`${y}-${pad(m!)}-${pad(lastDate)}`);
  const days: string[] = [];
  for (let week = firstWeek; ; week = addDays(week, 7)) {
    days.push(...weekDays(week));
    if (week === lastWeek) break;
  }
  return days;
}
