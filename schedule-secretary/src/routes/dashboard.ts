import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import { prisma } from "../db";
import { requireLogin } from "../middleware/auth";

export const dashboardRouter = Router();

dashboardRouter.get("/", requireLogin, ah(async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterStart = new Date(todayStart);
  dayAfterStart.setDate(dayAfterStart.getDate() + 2);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [counts, todayEvents, tomorrowEvents, weekEvents, recentEvents, recentErrors] = await Promise.all([
    prisma.scheduleCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.calendarEvent.findMany({
      where: { startAt: { gte: todayStart, lt: tomorrowStart }, status: { in: ["registered", "updated"] } },
      orderBy: { startAt: "asc" },
    }),
    prisma.calendarEvent.findMany({
      where: { startAt: { gte: tomorrowStart, lt: dayAfterStart }, status: { in: ["registered", "updated"] } },
      orderBy: { startAt: "asc" },
    }),
    prisma.calendarEvent.findMany({
      where: { startAt: { gte: todayStart, lt: weekEnd }, status: { in: ["registered", "updated"] } },
      orderBy: { startAt: "asc" },
      take: 20,
    }),
    prisma.calendarEvent.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c.status] = c._count._all;

  res.render("dashboard", {
    countMap,
    todayEvents,
    tomorrowEvents,
    weekEvents,
    recentEvents,
    recentErrors,
  });
}));
