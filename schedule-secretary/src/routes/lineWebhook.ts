import express, { Router } from "express";
import { ScheduleCandidate, User } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import {
  verifySignature,
  replyText,
  replyMessages,
  pushText,
  pushMessages,
  getDisplayName,
  getGroupMemberName,
} from "../services/line/lineClient";
import {
  buildApprovalMessage,
  buildRejectReasonMessage,
} from "../services/line/approvalCard";
import {
  analyzeMessage,
  effectiveData,
  recordError,
  approveCandidate,
  rejectCandidate,
} from "../services/candidateService";
import { formatDateJa } from "../utils/dates";

export const lineWebhookRouter = Router();

interface LineSource {
  type?: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: LineSource;
  message?: { id: string; type: string; text?: string; fileName?: string };
  postback?: { data: string };
}

/**
 * LINE公式アカウントのWebhook(第3段階)
 *
 * - 署名検証を通らないリクエストは一切処理しない
 * - LINEはタイムアウトが短いため、先に200を返してから解析する
 * - AIは候補を作るだけで、カレンダー登録は承認者の操作があったときのみ
 */
lineWebhookRouter.post(
  "/line/webhook",
  express.raw({ type: "*/*", limit: "2mb" }),
  (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.header("x-line-signature");

    if (!verifySignature(rawBody, signature)) {
      // 検証エラーの詳細は返さない(攻撃者に情報を与えないため)
      return res.status(401).send("invalid signature");
    }

    res.status(200).send("ok");

    let payload: { events?: LineEvent[] };
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      void recordError("line_webhook", new Error("Webhookの本文をJSONとして読み取れませんでした"));
      return;
    }

    for (const event of payload.events ?? []) {
      void handleEvent(event);
    }
  }
);

async function handleEvent(event: LineEvent): Promise<void> {
  try {
    if (event.type === "postback") {
      await handlePostback(event);
      return;
    }
    if (event.type !== "message" || !event.message) return;

    const src = event.source ?? {};
    const userId = src.userId;
    const senderName = await resolveSenderName(src);
    // グループ・複数人トークでは、そのトーク自体を送信元として記録する
    const isGroup = src.type === "group" || src.type === "room";
    const groupId = src.groupId ?? src.roomId ?? null;

    if (event.message.type !== "text") {
      await handleNonText(event, senderName, userId, isGroup);
      return;
    }

    const text = (event.message.text ?? "").trim();
    if (!text) return;

    const message = await prisma.message.create({
      data: {
        source: "line",
        senderName: isGroup ? `${senderName}(グループ)` : senderName,
        senderId: userId ?? groupId,
        rawText: text,
        receivedAt: new Date(),
      },
    });

    const result = await analyzeMessage(message.id);

    if (!result.ok) {
      await notifyApprover([
        {
          type: "text",
          text: `⚠️ LINEで受信した内容の解析に失敗しました。\n\n送信者: ${senderName}\n本文: ${truncate(text, 80)}\n\n管理画面から再解析してください。\n${link("/")}`,
        },
      ]);
      // グループでは失敗の返信をしない(会話の妨げになるため)
      if (!isGroup) await safeReply(event.replyToken, "受け付けました。内容の読み取りに失敗したため、代表者が確認します。");
      return;
    }

    const candidates = await prisma.scheduleCandidate.findMany({
      where: { id: { in: result.candidateIds } },
      orderBy: { id: "asc" },
    });
    const actionable = candidates.filter((c) => c.status !== "out_of_scope");

    // 雑談・挨拶は通知も返信もしない(通知が埋もれるのを防ぐ)
    if (actionable.length === 0) return;

    await notifyApprover([buildApprovalMessage(actionable, senderName)]);

    // 1対1では受付を返信。グループでは発言の流れを乱さないため返信しない。
    if (!isGroup) {
      await safeReply(
        event.replyToken,
        `受け付けました(${actionable.length}件)。\n代表者が承認するとカレンダーに登録されます。`
      );
    }
  } catch (err) {
    await recordError("line_event", err);
  }
}

/** トーク画面の承認・却下ボタンの処理 */
async function handlePostback(event: LineEvent): Promise<void> {
  const params = new URLSearchParams(event.postback?.data ?? "");
  const action = params.get("action");
  const candidateId = Number(params.get("id"));
  if (!action || !Number.isFinite(candidateId)) return;

  const userId = event.source?.userId;

  // 承認者以外はカレンダー登録・却下をできないようにする
  if (!config.lineApproverUserId || userId !== config.lineApproverUserId) {
    await safeReply(event.replyToken, "この操作は承認者のみ実行できます。");
    return;
  }

  const approver = await prisma.user.findFirst({ where: { role: "approver" }, orderBy: { id: "asc" } });
  if (!approver) {
    await safeReply(event.replyToken, "承認者アカウントが見つかりませんでした。管理画面をご確認ください。");
    return;
  }

  const candidate = await prisma.scheduleCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    await safeReply(event.replyToken, "対象の予定候補が見つかりませんでした。");
    return;
  }

  if (action === "approve") {
    await handleApprove(event, candidate, approver);
    return;
  }
  if (action === "reject") {
    await safeReplyMessages(event.replyToken, [buildRejectReasonMessage(candidateId)]);
    return;
  }
  if (action === "reject_reason") {
    const reason = params.get("reason") ?? null;
    await rejectCandidate(candidateId, approver, reason);
    await safeReply(
      event.replyToken,
      `拒否しました(理由: ${reason ?? "未記入"})。\nカレンダーには登録されません。履歴には残ります。`
    );
  }
}

async function handleApprove(event: LineEvent, candidate: ScheduleCandidate, approver: User): Promise<void> {
  if (candidate.status === "approved") {
    await safeReply(event.replyToken, "この予定はすでに承認・登録済みです。");
    return;
  }

  const result = await approveCandidate(candidate.id, approver);

  if (!result.ok || !result.registered) {
    await safeReply(
      event.replyToken,
      `登録できませんでした。\n${result.error ?? ""}\n\n詳細画面で内容を確認してください。\n${link(`/candidates/${candidate.id}`)}`
    );
    return;
  }

  const r = result.registered;
  const lines = [
    "✅ カレンダーに登録しました",
    "",
    `予定名: ${r.title}`,
    `日時: ${r.dateLabel}`,
    `カレンダー: ${r.calendarId}`,
    `承認: ${r.approverName} / ${r.approvedAt.toLocaleString("ja-JP")}`,
  ];
  if (r.htmlLink) lines.push("", r.htmlLink);
  await safeReply(event.replyToken, lines.join("\n"));
}

async function resolveSenderName(src: LineSource): Promise<string> {
  const userId = src.userId;
  if (!userId) return "LINE利用者";
  if (src.type === "group" && src.groupId) {
    return (await getGroupMemberName("group", src.groupId, userId)) ?? "LINE利用者";
  }
  if (src.type === "room" && src.roomId) {
    return (await getGroupMemberName("room", src.roomId, userId)) ?? "LINE利用者";
  }
  return (await getDisplayName(userId)) ?? "LINE利用者";
}

async function handleNonText(
  event: LineEvent,
  senderName: string,
  userId?: string,
  isGroup = false
): Promise<void> {
  const kind =
    event.message?.type === "image" ? "画像" : event.message?.type === "file" ? "ファイル" : "添付";
  const name = event.message?.fileName ? `(${event.message.fileName})` : "";

  await prisma.message.create({
    data: {
      source: "line",
      senderName: isGroup ? `${senderName}(グループ)` : senderName,
      senderId: userId ?? null,
      rawText: `【${kind}${name}を受信】LINEメッセージID: ${event.message?.id ?? "-"}`,
      receivedAt: new Date(),
      status: "received",
    },
  });

  await notifyApprover([
    {
      type: "text",
      text: `📎 ${senderName} さんから${kind}${name}が届きました。\n\n現在この形式の自動読み取りには未対応です。内容を確認し、必要であれば管理画面から文章で入力してください。\n${link("/messages/new")}`,
    },
  ]);
  if (!isGroup) await safeReply(event.replyToken, `${kind}を受け付けました。代表者が内容を確認します。`);
}

/** 通知が埋もれないよう、承認者への文面には要点だけを載せる */
export function summarize(candidate: ScheduleCandidate): string {
  const d = effectiveData(candidate);
  const date = d.date ? formatDateJa(d.date) : "日付未確定";
  return `${d.event_type ?? "その他"} ${d.title ?? d.address ?? "現場未定"} ${date}`;
}

function link(path: string): string {
  return config.appBaseUrl ? `${config.appBaseUrl}${path}` : "";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function notifyApprover(messages: Array<Record<string, unknown>>): Promise<void> {
  if (!config.lineApproverUserId) return;
  try {
    await pushMessages(config.lineApproverUserId, messages);
  } catch (err) {
    await recordError("line_push", err);
    // Flexの送信に失敗した場合でも承認依頼が届くよう、文章で送り直す
    try {
      await pushText(
        config.lineApproverUserId,
        `予定候補が届きました。管理画面で確認してください。\n${link("/candidates?status=pending")}`
      );
    } catch {
      /* 記録済みのため何もしない */
    }
  }
}

async function safeReply(replyToken: string | undefined, text: string): Promise<void> {
  if (!replyToken) return;
  try {
    await replyText(replyToken, text);
  } catch (err) {
    await recordError("line_reply", err);
  }
}

async function safeReplyMessages(
  replyToken: string | undefined,
  messages: Array<Record<string, unknown>>
): Promise<void> {
  if (!replyToken) return;
  try {
    await replyMessages(replyToken, messages);
  } catch (err) {
    await recordError("line_reply", err);
  }
}
