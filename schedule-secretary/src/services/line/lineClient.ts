import crypto from "crypto";
import { config } from "../../config";

const API = "https://api.line.me/v2/bot";

/**
 * LINE Webhookの署名検証。
 * チャネルシークレットで生の本文をHMAC-SHA256し、X-Line-Signatureと一致するか確認する。
 * これを通らないリクエストは第三者からの偽装の可能性があるため一切処理しない。
 */
export function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !config.lineChannelSecret) return false;
  const expected = crypto
    .createHmac("sha256", config.lineChannelSecret)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function callLine(path: string, body: unknown): Promise<void> {
  if (!config.lineChannelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.lineChannelAccessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`LINE API エラー (${res.status}): ${describeLineError(raw)}`);
  }
}

/**
 * LINEのエラー応答から原因を読み取れる形にする。
 * detailsに不備のあるプロパティの場所が入るため、それを必ず残す。
 */
function describeLineError(raw: string): string {
  try {
    const body = JSON.parse(raw) as {
      message?: string;
      details?: Array<{ message?: string; property?: string }>;
    };
    const parts: string[] = [];
    if (body.message) parts.push(body.message);
    for (const d of body.details ?? []) {
      parts.push(`${d.property ?? "?"} → ${d.message ?? "?"}`);
    }
    return parts.length > 0 ? parts.join(" / ").slice(0, 600) : raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/** LINEのメッセージオブジェクト(テキスト/Flex等) */
export type LineMessage = Record<string, unknown>;

/** 送信者への返信(replyTokenは1回のみ・約1分で失効) */
export async function replyText(replyToken: string, text: string): Promise<void> {
  await callLine("/message/reply", { replyToken, messages: [{ type: "text", text }] });
}

export async function replyMessages(replyToken: string, messages: LineMessage[]): Promise<void> {
  await callLine("/message/reply", { replyToken, messages: messages.slice(0, 5) });
}

/** 承認者へのプッシュ通知 */
export async function pushText(to: string, text: string): Promise<void> {
  await callLine("/message/push", { to, messages: [{ type: "text", text }] });
}

export async function pushMessages(to: string, messages: LineMessage[]): Promise<void> {
  await callLine("/message/push", { to, messages: messages.slice(0, 5) });
}

async function fetchProfile(path: string): Promise<string | null> {
  if (!config.lineChannelAccessToken) return null;
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { displayName?: string };
    return data.displayName ?? null;
  } catch {
    return null;
  }
}

/** 1対1トークの送信者名 */
export async function getDisplayName(userId: string): Promise<string | null> {
  return fetchProfile(`/profile/${userId}`);
}

/** グループ・複数人トークの発言者名(1対1とは別のAPIが必要) */
export async function getGroupMemberName(
  sourceType: "group" | "room",
  sourceId: string,
  userId: string
): Promise<string | null> {
  const path =
    sourceType === "group"
      ? `/group/${sourceId}/member/${userId}`
      : `/room/${sourceId}/member/${userId}`;
  return fetchProfile(path);
}

export function isLineConfigured(): boolean {
  return !!config.lineChannelSecret && !!config.lineChannelAccessToken;
}
