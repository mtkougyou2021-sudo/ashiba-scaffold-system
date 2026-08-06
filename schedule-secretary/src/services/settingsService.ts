import { prisma } from "../db";
import { config } from "../config";

export interface NotificationSettings {
  dayBeforeHour: number; // 前日の通知時刻(時)
  minutesBefore: number; // 開始何分前に通知するか
}

export interface AppSettings {
  notifications: NotificationSettings;
  calendarId: string;
  /** 予定種類 → GoogleカレンダーcolorId("1"〜"11") */
  colors: Record<string, string>;
  defaultEventHours: number; // 終了時刻が無い場合の既定の所要時間
}

export const DEFAULT_COLORS: Record<string, string> = {
  現調: "5", // イエロー
  足場組立: "9", // ブルーベリー
  足場解体: "6", // オレンジ
  打合せ: "3", // グレープ
  材料搬入: "7", // ピーコック
  見積期限: "11", // トマト
  電話: "8", // グラファイト
  仮予定: "8",
  その他: "1", // ラベンダー
};

const DEFAULTS: AppSettings = {
  notifications: { dayBeforeHour: 18, minutesBefore: 60 },
  calendarId: config.googleCalendarId,
  colors: DEFAULT_COLORS,
  defaultEventHours: 1,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value as unknown]));
  return {
    notifications: (map.get("notifications") as NotificationSettings) ?? DEFAULTS.notifications,
    calendarId: (map.get("calendarId") as string) ?? DEFAULTS.calendarId,
    colors: { ...DEFAULT_COLORS, ...((map.get("colors") as Record<string, string>) ?? {}) },
    defaultEventHours: (map.get("defaultEventHours") as number) ?? DEFAULTS.defaultEventHours,
  };
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: value as any },
    create: { key, value: value as any },
  });
}

export async function ensureDefaultSettings(): Promise<void> {
  const existing = await prisma.systemSetting.findMany();
  const keys = new Set(existing.map((r) => r.key));
  if (!keys.has("notifications")) await saveSetting("notifications", DEFAULTS.notifications);
  if (!keys.has("calendarId")) await saveSetting("calendarId", DEFAULTS.calendarId);
  if (!keys.has("colors")) await saveSetting("colors", DEFAULT_COLORS);
  if (!keys.has("defaultEventHours")) await saveSetting("defaultEventHours", DEFAULTS.defaultEventHours);
}
