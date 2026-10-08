export type StatsView = "month" | "year";
export interface StatsNavigation {
  view: StatsView;
  date: string;
}

export function isStatsMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2 && Number(value.slice(0, 4)) <= 9998;
}

export function readStatsNavigation(params: Pick<URLSearchParams, "get">, today: string): StatsNavigation {
  const date = params.get("date") || "";
  return {
    view: params.get("view") === "year" ? "year" : "month",
    date: isStatsMonth(date) ? date : today.slice(0, 7),
  };
}

export function statsNavigationHref(selection: StatsNavigation) {
  const params = new URLSearchParams({ view: selection.view, date: selection.date });
  return `/dashboard/stats?${params}`;
}

/** Keep the selected month when moving between years; month steps cross year boundaries. */
export function stepStatsDate(date: string, view: StatsView, step: -1 | 1): string | null {
  if (!isStatsMonth(date)) return null;
  const [year, month] = date.split("-").map(Number);
  const index = year * 12 + month - 1 + step * (view === "year" ? 12 : 1);
  const next = `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
  return isStatsMonth(next) ? next : null;
}
