import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import { prisma } from "../db";
import { requireLogin } from "../middleware/auth";
import { analyzeMessage, addApprovalLog } from "../services/candidateService";

export const messagesRouter = Router();

messagesRouter.get("/messages/new", requireLogin, (_req, res) => {
  res.render("message_new", { error: null });
});

/** 管理画面からの文章入力 → AI解析 → 予定候補作成(第1段階) */
messagesRouter.post("/messages", requireLogin, ah(async (req, res) => {
  const text = (req.body.text as string | undefined)?.trim();
  if (!text) return res.render("message_new", { error: "文章を入力してください" });

  const message = await prisma.message.create({
    data: {
      source: "admin_text",
      senderName: req.currentUser!.name,
      rawText: text,
      receivedAt: new Date(),
    },
  });

  const result = await analyzeMessage(message.id);
  if (!result.ok) {
    return res.render("analyze_result", { message, candidates: [], error: result.error });
  }
  const candidates = await prisma.scheduleCandidate.findMany({
    where: { id: { in: result.candidateIds } },
    orderBy: { id: "asc" },
  });
  res.render("analyze_result", { message, candidates, error: null });
}));

/** AI解析失敗時の再解析 */
messagesRouter.post("/messages/:id/reanalyze", requireLogin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const result = await analyzeMessage(id);
  await addApprovalLog(req.currentUser!.id, null, "reanalyze", { messageId: id, ok: result.ok });
  if (result.ok && result.candidateIds.length > 0) {
    return res.redirect(`/candidates/${result.candidateIds[0]}`);
  }
  res.redirect("/");
}));
