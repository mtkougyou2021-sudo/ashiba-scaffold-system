import { Prisma, ScheduleCandidate, User } from "@prisma/client";
import { prisma } from "../db";
import { maskSecrets } from "../config";
import { getExtractor, ExtractedCandidate, Classification } from "./ai";
import { getCalendarService, CalendarEventInput } from "./calendar/googleCalendar";
import { getSettings } from "./settingsService";
import { formatDateJa } from "../utils/dates";

/** AI分類 → 候補ステータスの対応 */
const CLASSIFICATION_TO_STATUS: Record<Classification, string> = {
  approval_pending: "pending",
  insufficient: "insufficient",
  tentative: "tentative",
  change_candidate: "change_candidate",
  cancel_candidate: "cancel_candidate",
  out_of_scope: "out_of_scope",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "承認待ち",
  insufficient: "情報不足",
  tentative: "仮予定",
  change_candidate: "変更候補",
  cancel_candidate: "中止候補",
  out_of_scope: "対象外",
  approved: "承認済み",
  rejected: "拒否",
  on_hold: "保留",
  register_error: "登録エラー",
};

export async function recordError(context: string, err: unknown, detail?: Record<string, unknown>) {
  const message = maskSecrets(err instanceof Error ? err.message : String(err));
  console.error(`[error] ${context}: ${message}`);
  await prisma.errorLog
    .create({ data: { context, message, detail: (detail as Prisma.InputJsonValue) ?? undefined } })
    .catch(() => {});
}

export async function addApprovalLog(userId: number, candidateId: number | null, action: string, detail?: Record<string, unknown>) {
  await prisma.approvalLog.create({
    data: { userId, candidateId, action, detail: (detail as Prisma.InputJsonValue) ?? undefined },
  });
}

/** 文章を受信してAI解析し、予定候補を作成する */
export async function analyzeMessage(messageId: number): Promise<{ ok: boolean; candidateIds: number[]; error?: string }> {
  const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
  if (!message.rawText) return { ok: false, candidateIds: [], error: "文章がありません" };

  try {
    const result = await getExtractor().extract({
      text: message.rawText,
      receivedAt: message.receivedAt,
      senderName: message.senderName ?? undefined,
    });

    const ids: number[] = [];
    for (const c of result.candidates) {
      const created = await prisma.scheduleCandidate.create({
        data: {
          messageId: message.id,
          sourceText: c.source_text || message.rawText,
          extractedData: c as unknown as Prisma.InputJsonValue,
          aiClassification: c.classification,
          confidence: c.confidence,
          missingFields: c.missing_fields as Prisma.InputJsonValue,
          isTentative: c.is_tentative,
          changeType: c.change_type,
          status: CLASSIFICATION_TO_STATUS[c.classification],
        },
      });
      ids.push(created.id);
    }
    await prisma.message.update({ where: { id: messageId }, data: { status: "analyzed" } });
    return { ok: true, candidateIds: ids };
  } catch (err) {
    // 元データは残し、再解析できるようにする
    await prisma.message.update({ where: { id: messageId }, data: { status: "analyze_error" } });
    await recordError("ai_analyze", err, { messageId });
    return { ok: false, candidateIds: [], error: maskSecrets(err instanceof Error ? err.message : String(err)) };
  }
}

/** 表示・登録に使う実効データ(修正後データがあれば優先) */
export function effectiveData(candidate: ScheduleCandidate): ExtractedCandidate {
  const base = candidate.extractedData as unknown as ExtractedCandidate;
  const mod = candidate.modifiedData as unknown as Partial<ExtractedCandidate> | null;
  return { ...base, ...(mod ?? {}) };
}

/** 予定名: 【予定区分】現場名／作業内容 */
export function buildEventTitle(data: ExtractedCandidate): string {
  const type = data.event_type || "その他";
  const site = data.title || data.address || "現場未定";
  const work = data.work_description;
  return work ? `【${type}】${site}／${work}` : `【${type}】${site}`;
}

export function buildEventDescription(data: ExtractedCandidate, approvedAt: Date, approverName: string): string {
  const lines: string[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") lines.push(`■${label}: ${value}`);
  };
  add("元請名", data.client_name);
  add("現場名", data.title);
  add("住所", data.address);
  add("担当者", data.assignee);
  add("人数", data.workers !== null ? `${data.workers}名` : null);
  add("集合時間", data.meeting_time);
  add("集合場所", data.meeting_place);
  add("作業内容", data.work_description);
  add("持ち物", data.items);
  add("必要車両", data.vehicles);
  add("注意事項", data.cautions);
  if (data.notes.length > 0) lines.push(`■備考:\n${data.notes.map((n) => `・${n}`).join("\n")}`);
  lines.push("");
  lines.push(`■元情報:\n${data.source_text}`);
  lines.push("");
  lines.push(`■承認: ${approverName} / ${approvedAt.toLocaleString("ja-JP")}`);
  lines.push("(AI予定管理秘書システムにより承認登録)");
  return lines.join("\n");
}

export interface ApproveResult {
  ok: boolean;
  error?: string;
  registered?: {
    title: string;
    dateLabel: string;
    calendarId: string;
    htmlLink: string | null;
    approverName: string;
    approvedAt: Date;
  };
}

/**
 * 承認処理。承認者の承認操作があった場合のみ呼ばれ、ここで初めてGoogleカレンダーへ登録する。
 * 失敗時は approved にせず register_error とする。
 */
export async function approveCandidate(candidateId: number, user: User): Promise<ApproveResult> {
  const candidate = await prisma.scheduleCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  if (candidate.status === "approved") return { ok: false, error: "すでに承認済みです" };

  const data = effectiveData(candidate);
  if (!data.date) {
    return { ok: false, error: "日付が確定していません。修正画面で日付を入力してから承認してください。" };
  }

  const settings = await getSettings();
  const approvedAt = new Date();
  const title = buildEventTitle(data);
  const isTentative = data.is_tentative;
  const colorId = settings.colors[isTentative ? "仮予定" : data.event_type || "その他"] ?? settings.colors["その他"];

  const input: CalendarEventInput = {
    calendarId: settings.calendarId,
    title,
    description: buildEventDescription(data, approvedAt, user.name),
    date: data.date,
    startTime: data.start_time,
    endTime: data.end_time,
    allDay: data.all_day || !data.start_time,
    colorId,
    reminders: settings.notifications,
    defaultEventHours: settings.defaultEventHours,
  };

  try {
    const result = await getCalendarService().insertEvent(input);
    const event = await prisma.calendarEvent.create({
      data: {
        candidateId: candidate.id,
        googleEventId: result.googleEventId,
        calendarId: settings.calendarId,
        title,
        startAt: result.startAt,
        endAt: result.endAt,
        allDay: input.allDay,
        status: "registered",
        registeredById: user.id,
      },
    });
    await prisma.scheduleCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "approved",
        approvedById: user.id,
        approvedAt,
        googleEventId: result.googleEventId,
      },
    });
    await addApprovalLog(user.id, candidate.id, "approve", { title, date: data.date });
    await addApprovalLog(user.id, candidate.id, "calendar_register", { googleEventId: result.googleEventId, calendarEventId: event.id });

    const dateLabel = `${formatDateJa(data.date)}${data.start_time ? ` ${data.start_time}` : "(終日)"}${data.end_time ? `〜${data.end_time}` : ""}`;
    return {
      ok: true,
      registered: {
        title,
        dateLabel,
        calendarId: settings.calendarId,
        htmlLink: result.htmlLink,
        approverName: user.name,
        approvedAt,
      },
    };
  } catch (err) {
    await prisma.scheduleCandidate.update({ where: { id: candidate.id }, data: { status: "register_error" } });
    await recordError("calendar_register", err, { candidateId: candidate.id });
    return { ok: false, error: `Googleカレンダー登録に失敗しました: ${maskSecrets(err instanceof Error ? err.message : String(err))}` };
  }
}

export async function rejectCandidate(candidateId: number, user: User, reason: string | null): Promise<void> {
  // 拒否した情報は削除せず履歴として保存する
  await prisma.scheduleCandidate.update({
    where: { id: candidateId },
    data: { status: "rejected", rejectReason: reason || null, approvedById: user.id },
  });
  await addApprovalLog(user.id, candidateId, "reject", { reason });
}

export async function holdCandidate(candidateId: number, user: User): Promise<void> {
  await prisma.scheduleCandidate.update({ where: { id: candidateId }, data: { status: "on_hold" } });
  await addApprovalLog(user.id, candidateId, "hold");
}

export async function addNote(candidateId: number, user: User, note: string): Promise<void> {
  const candidate = await prisma.scheduleCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const data = effectiveData(candidate);
  const notes = [...data.notes, note];
  await prisma.scheduleCandidate.update({
    where: { id: candidateId },
    data: { modifiedData: { ...(candidate.modifiedData as object ?? {}), notes } as Prisma.InputJsonValue },
  });
  await addApprovalLog(user.id, candidateId, "add_note", { note });
}

/** 承認者による修正の保存。修正前データ(extractedData)はそのまま残す。 */
export async function saveModification(candidateId: number, user: User, fields: Partial<ExtractedCandidate>): Promise<void> {
  const candidate = await prisma.scheduleCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const merged = { ...(candidate.modifiedData as object ?? {}), ...fields };
  const updates: Prisma.ScheduleCandidateUpdateInput = { modifiedData: merged as Prisma.InputJsonValue };
  // 日付・時刻が補完されて情報不足が解消したら承認待ちへ進める
  if (candidate.status === "insufficient" || candidate.status === "tentative") {
    const data = { ...effectiveData(candidate), ...fields };
    if (data.date && (data.start_time || data.all_day)) updates.status = "pending";
  }
  await prisma.scheduleCandidate.update({ where: { id: candidateId }, data: updates });
  await addApprovalLog(user.id, candidateId, "modify", { fields: fields as Record<string, unknown> });
}
