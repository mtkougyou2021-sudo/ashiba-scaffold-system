import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import { requireLogin, requireApprover } from "../middleware/auth";
import { getSettings, saveSetting, DEFAULT_COLORS } from "../services/settingsService";
import { prisma } from "../db";

export const settingsRouter = Router();

const GOOGLE_COLORS: Record<string, string> = {
  "1": "ラベンダー",
  "2": "セージ",
  "3": "グレープ",
  "4": "フラミンゴ",
  "5": "バナナ",
  "6": "ミカン",
  "7": "ピーコック",
  "8": "グラファイト",
  "9": "ブルーベリー",
  "10": "バジル",
  "11": "トマト",
};

settingsRouter.get("/settings", requireLogin, ah(async (_req, res) => {
  const settings = await getSettings();
  res.render("settings", { settings, googleColors: GOOGLE_COLORS, saved: false });
}));

settingsRouter.post("/settings", requireLogin, requireApprover, ah(async (req, res) => {
  const body = req.body as Record<string, string>;
  const dayBeforeHour = Math.min(23, Math.max(0, Number(body.dayBeforeHour ?? 18) || 18));
  const minutesBefore = Math.min(40320, Math.max(0, Number(body.minutesBefore ?? 60) || 60));
  const defaultEventHours = Math.min(24, Math.max(1, Number(body.defaultEventHours ?? 1) || 1));
  const calendarId = (body.calendarId || "primary").trim();

  const colors: Record<string, string> = {};
  for (const type of Object.keys(DEFAULT_COLORS)) {
    const v = body[`color_${type}`];
    colors[type] = v && GOOGLE_COLORS[v] ? v : DEFAULT_COLORS[type];
  }

  await saveSetting("notifications", { dayBeforeHour, minutesBefore });
  await saveSetting("calendarId", calendarId);
  await saveSetting("colors", colors);
  await saveSetting("defaultEventHours", defaultEventHours);

  const settings = await getSettings();
  res.render("settings", { settings, googleColors: GOOGLE_COLORS, saved: true });
}));

settingsRouter.get("/history", requireLogin, ah(async (_req, res) => {
  const [events, logs] = await Promise.all([
    prisma.calendarEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { registeredBy: true, candidate: true },
    }),
    prisma.approvalLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    }),
  ]);
  res.render("history", { events, logs });
}));
