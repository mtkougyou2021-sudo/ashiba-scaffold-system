import { NextFunction, Request, Response } from "express";
import { User } from "@prisma/client";
import { prisma } from "../db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

/** ログイン必須 */
export async function requireLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.redirect("/login");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      req.session = null;
      return res.redirect("/login");
    }
    req.currentUser = user;
    res.locals.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** 承認・カレンダー登録は承認者(代表者)のみ */
export function requireApprover(req: Request, res: Response, next: NextFunction) {
  if (req.currentUser?.role !== "approver") {
    return res.status(403).render("error", { title: "権限がありません", message: "この操作は承認者のみ実行できます。" });
  }
  next();
}
