/** 日付ユーティリティ(タイムゾーンは Asia/Tokyo 前提。TZ環境変数で固定する) */

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 月日から、基準日以降で最も近い日付を返す(年の推測はここで一元管理し、注記対象とする) */
export function nearestFutureDate(base: Date, month: number, day: number): string {
  const candidate = new Date(base.getFullYear(), month - 1, day);
  const baseDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (candidate < baseDate) candidate.setFullYear(candidate.getFullYear() + 1);
  return toDateString(candidate);
}

/** 日のみ(「15日」)から、基準日以降で最も近い日付を返す */
export function nearestFutureDayOfMonth(base: Date, day: number): string {
  const candidate = new Date(base.getFullYear(), base.getMonth(), day);
  const baseDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (candidate < baseDate) candidate.setMonth(candidate.getMonth() + 1);
  return toDateString(candidate);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 曜日名(「火」)から、基準日の翌日以降で最も近いその曜日の日付を返す */
export function nextWeekday(base: Date, weekdayName: string): string | null {
  const target = WEEKDAYS.indexOf(weekdayName);
  if (target < 0) return null;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== target);
  return toDateString(d);
}

/** 全角数字→半角 */
export function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/：/g, ":");
}

export function formatDateJa(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${wd})`;
}
