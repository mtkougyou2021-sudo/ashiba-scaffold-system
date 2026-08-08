import express, { Router } from "express";
import { ScheduleCandidate } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { verifySignature, replyText, pushText, getDisplayName } from "../services/line/lineClient";
import { analyzeMessage, effectiveData, recordError, STATUS_LABELS } from "../services/candidateService";
import { formatDateJa } from "../utils/dates";

export const lineWebhookRouter = Router();

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { id: string; type: string; text?: string; fileName?: string };
}

/**
 * LINE公式アカウントのWebhook(第3段階)
 *
 * - 署名検証を通らないリクエストは一切処理しない
 * - LINEはタイムアウトが短いため、先に200を返してから解析する
 * - AIは候補を作るだけで、カレンダーには登録しない(承認は管理画面で行う)
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

    // 先に応答を返し、解析は後続で行う
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
    if (event.type !== "message" || !event.message) return;

    const userId = event.source?.userId;
    const senderName = userId ? (await getDisplayName(userId)) ?? "LINE利用者" : "LINE利用者";

    // 文章以外(画像・PDF等)は第2段階で解析する。取りこぼさないよう記録と通知だけ行う。
    if (event.message.type !== "text") {
      await handleNonText(event, senderName, userId);
      return;
    }

    const text = (event.message.text ?? "").trim();
    if (!text) return;

    const message = await prisma.message.create({
      data: { source: "line", senderName, senderId: userId ?? null, rawText: text, receivedAt: new Date() },
    });

    const result = await analyzeMessage(message.id);

    if (!result.ok) {
      await notifyApprover(
        `⚠️ LINEで受信した内容の解析に失敗しました。\n\n送信者: ${senderName}\n本文: ${truncate(text, 80)}\n\n管理画面から再解析してください。\n${link("/")}`
      );
      await safeReply(event.replyToken, "受け付けました。内容の読み取りに失敗したため、代表者が確認します。");
      return;
    }

    const candidates = await prisma.scheduleCandidate.findMany({
      where: { id: { in: result.candidateIds } },
      orderBy: { id: "asc" },
    });

    const actionable = candidates.filter((c) => c.status !== "out_of_scope");

    if (actionable.length === 0) {
      // 雑談・挨拶などは承認者に通知しない(通知が埋もれるのを防ぐ)
      return;
    }

    await notifyApprover(buildApprovalMessage(actionable, senderName));
    await safeReply(
      event.replyToken,
      `受け付けました(${actionable.length}件)。\n代表者が承認するとカレンダーに登録されます。`
    );
  } catch (err) {
    await recordError("line_event", err);
  }
}

async function handleNonText(event: LineEvent, senderName: string, userId?: string): Promise<void> {
  const kind =
    event.message?.type === "image" ? "画像" : event.message?.type === "file" ? "ファイル" : "添付";
  const name = event.message?.fileName ? `(${event.message.fileName})` : "";

  await prisma.message.create({
    data: {
      source: "line",
      senderName,
      senderId: userId ?? null,
      rawText: `【${kind}${name}を受信】LINEメッセージID: ${event.message?.id ?? "-"}`,
      receivedAt: new Date(),
      status: "received",
    },
  });

  await notifyApprover(
    `📎 ${senderName} さんから${kind}${name}が届きました。\n\n現在この形式の自動読み取りには未対応です。内容を確認し、必要であれば管理画面から文章で入力してください。\n${link("/messages/new")}`
  );
  await safeReply(
    event.replyToken,
    `${kind}を受け付けました。代表者が内容を確認します。`
  );
}

function buildApprovalMessage(candidates: ScheduleCandidate[], senderName: string): string {
  const lines: string[] = [`📋 ${senderName} さんから予定候補が届きました(${candidates.length}件)`, ""];

  for (const c of candidates.slice(0, 5)) {
    const d = effectiveData(c);
    const dateLabel = d.date
      ? formatDateJa(d.date)
      : d.date_candidates.length > 0
        ? `候補: ${d.date_candidates.map(formatDateJa).join("、")}(要確認)`
        : "日付未確定";
    const timeLabel = d.start_time ? ` ${d.start_time}` : "";
    const site = d.title || d.address || "現場未定";
    const type = d.event_type ? `【${d.event_type}】` : "";

    lines.push(`━━━━━━━━━━`);
    lines.push(`${STATUS_LABELS[c.status] ?? c.status}`);
    lines.push(`${type}${site}`);
    lines.push(`${dateLabel}${timeLabel}`);
    if (d.workers) lines.push(`人数: ${d.workers}名`);
    if (d.missing_fields.length > 0) lines.push(`不足: ${d.missing_fields.join("、")}`);
    lines.push(link(`/candidates/${c.id}`));
  }

  if (candidates.length > 5) {
    lines.push(`━━━━━━━━━━`);
    lines.push(`ほか${candidates.length - 5}件`);
    lines.push(link("/candidates?status=pending"));
  }

  lines.push("");
  lines.push("※承認するまでカレンダーには登録されません。");
  return lines.join("\n");
}

function link(path: string): string {
  return config.appBaseUrl ? `${config.appBaseUrl}${path}` : "";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function notifyApprover(text: string): Promise<void> {
  if (!config.lineApproverUserId) return;
  try {
    await pushText(config.lineApproverUserId, text);
  } catch (err) {
    await recordError("line_push", err);
  }
}

async function safeReply(replyToken: string | undefined, text: string): Promise<void> {
  if (!replyToken) return;
  try {
    await replyText(replyToken, text);
  } catch (err) {
    // 返信失敗は業務上の支障が小さいため記録のみ
    await recordError("line_reply", err);
  }
}
