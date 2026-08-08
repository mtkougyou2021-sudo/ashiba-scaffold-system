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
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API エラー (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/** 送信者への返信(replyTokenは1回のみ・約1分で失効) */
export async function replyText(replyToken: string, text: string): Promise<void> {
  await callLine("/message/reply", { replyToken, messages: [{ type: "text", text }] });
}

/** 承認者へのプッシュ通知 */
export async function pushText(to: string, text: string): Promise<void> {
  await callLine("/message/push", { to, messages: [{ type: "text", text }] });
}

/** 送信者の表示名を取得(取得できなくても処理は続行する) */
export async function getDisplayName(userId: string): Promise<string | null> {
  if (!config.lineChannelAccessToken) return null;
  try {
    const res = await fetch(`${API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { displayName?: string };
    return data.displayName ?? null;
  } catch {
    return null;
  }
}

export function isLineConfigured(): boolean {
  return !!config.lineChannelSecret && !!config.lineChannelAccessToken;
}
