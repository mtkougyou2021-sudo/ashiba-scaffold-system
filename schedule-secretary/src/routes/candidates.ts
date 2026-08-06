import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import { prisma } from "../db";
import { requireLogin, requireApprover } from "../middleware/auth";
import {
  STATUS_LABELS,
  approveCandidate,
  rejectCandidate,
  holdCandidate,
  addNote,
  saveModification,
  effectiveData,
  buildEventTitle,
} from "../services/candidateService";
import { ExtractedCandidate } from "../services/ai";

export const candidatesRouter = Router();

const LIST_STATUSES = [
  "pending",
  "insufficient",
  "tentative",
  "change_candidate",
  "cancel_candidate",
  "approved",
  "rejected",
  "on_hold",
  "register_error",
  "out_of_scope",
];

candidatesRouter.get("/candidates", requireLogin, ah(async (req, res) => {
  const status = (req.query.status as string) || "pending";
  if (!LIST_STATUSES.includes(status)) return res.redirect("/candidates?status=pending");
  const candidates = await prisma.scheduleCandidate.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { message: true, approvedBy: true },
  });
  res.render("candidates_list", {
    status,
    statusLabel: STATUS_LABELS[status],
    candidates,
    effectiveData,
    buildEventTitle,
  });
}));

candidatesRouter.get("/candidates/:id", requireLogin, ah(async (req, res) => {
  const candidate = await prisma.scheduleCandidate.findUnique({
    where: { id: Number(req.params.id) },
    include: { message: true, approvedBy: true, calendarEvents: true },
  });
  if (!candidate) return res.status(404).render("error", { title: "見つかりません", message: "予定候補が見つかりません。" });
  res.render("candidate_detail", {
    candidate,
    data: effectiveData(candidate),
    original: candidate.extractedData as unknown as ExtractedCandidate,
    statusLabel: STATUS_LABELS[candidate.status],
    flash: req.query.msg ?? null,
    error: req.query.error ?? null,
  });
}));

function parseForm(rawBody: Record<string, unknown>): Partial<ExtractedCandidate> {
  // 同名パラメータが複数来た場合(配列)や不正な型でも落ちないよう文字列へ正規化する
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawBody)) {
    body[k] = Array.isArray(v) ? String(v[v.length - 1] ?? "") : typeof v === "string" ? v : "";
  }
  const str = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);
  const fields: Partial<ExtractedCandidate> = {
    date: str(body.date),
    start_time: str(body.start_time),
    end_time: str(body.end_time),
    all_day: body.all_day === "on",
    event_type: str(body.event_type),
    title: str(body.title),
    client_name: str(body.client_name),
    requester_name: str(body.requester_name),
    address: str(body.address),
    work_description: str(body.work_description),
    workers: body.workers && body.workers.trim() !== "" ? Number(body.workers) : null,
    assignee: str(body.assignee),
    meeting_time: str(body.meeting_time),
    meeting_place: str(body.meeting_place),
    items: str(body.items),
    vehicles: str(body.vehicles),
    cautions: str(body.cautions),
    is_tentative: body.is_tentative === "on",
  };
  if (body.notes !== undefined) {
    fields.notes = body.notes
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return fields;
}

/** 修正の保存(修正前データは保持) */
candidatesRouter.post("/candidates/:id/save", requireLogin, requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  await saveModification(id, req.currentUser!, parseForm(req.body));
  res.redirect(`/candidates/${id}?msg=${encodeURIComponent("修正を保存しました")}`);
}));

/** 承認 → ここで初めてGoogleカレンダーへ登録される */
candidatesRouter.post("/candidates/:id/approve", requireLogin, requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  // 承認画面で編集された内容があれば先に保存してから登録する
  if (req.body.date !== undefined) {
    await saveModification(id, req.currentUser!, parseForm(req.body));
  }
  const result = await approveCandidate(id, req.currentUser!);
  if (!result.ok) {
    return res.redirect(`/candidates/${id}?error=${encodeURIComponent(result.error ?? "承認に失敗しました")}`);
  }
  res.render("approved", { registered: result.registered, candidateId: id });
}));

/** 登録エラー後の再登録 */
candidatesRouter.post("/candidates/:id/retry", requireLogin, requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  const result = await approveCandidate(id, req.currentUser!);
  if (!result.ok) {
    return res.redirect(`/candidates/${id}?error=${encodeURIComponent(result.error ?? "再登録に失敗しました")}`);
  }
  res.render("approved", { registered: result.registered, candidateId: id });
}));

candidatesRouter.post("/candidates/:id/reject", requireLogin, requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  const preset = (req.body.reason_preset as string) || "";
  const free = ((req.body.reason as string) || "").trim();
  const reason = [preset, free].filter((s) => s && s !== "その他").join(" / ") || null;
  await rejectCandidate(id, req.currentUser!, reason);
  res.redirect(`/candidates/${id}?msg=${encodeURIComponent("拒否しました(履歴として保存されます)")}`);
}));

candidatesRouter.post("/candidates/:id/hold", requireLogin, requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  await holdCandidate(id, req.currentUser!);
  res.redirect(`/candidates/${id}?msg=${encodeURIComponent("保留にしました")}`);
}));

candidatesRouter.post("/candidates/:id/note", requireLogin, requireApprover, ah(async (req, res) => {
  const id = Number(req.params.id);
  const note = ((req.body.note as string) || "").trim();
  if (note) await addNote(id, req.currentUser!, note);
  res.redirect(`/candidates/${id}?msg=${encodeURIComponent("備考を追加しました")}`);
}));
