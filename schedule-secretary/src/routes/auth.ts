import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import bcrypt from "bcryptjs";
import { prisma } from "../db";

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.render("login", { error: null });
});

authRouter.post("/login", ah(async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.render("login", { error: "メールアドレスとパスワードを入力してください" });
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.render("login", { error: "メールアドレスまたはパスワードが違います" });
  }
  req.session = { userId: user.id };
  res.redirect("/");
}));

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.redirect("/login");
});
