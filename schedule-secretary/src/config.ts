import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "",
  aiProvider: (process.env.AI_PROVIDER || "openai") as "openai" | "mock",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  calendarMode: (process.env.GOOGLE_CALENDAR_MODE || "real") as "real" | "mock",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  // LINE連携(第3段階)
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET || "",
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
  lineApproverUserId: process.env.LINE_APPROVER_USER_ID || "",
  // 承認画面へのリンクを作るための公開URL(末尾のスラッシュは付けない)
  appBaseUrl: (process.env.APP_BASE_URL || "").replace(/\/+$/, ""),
  isProduction: process.env.NODE_ENV === "production",
};

/** エラーメッセージからAPIキー等の秘密情報を除去する */
export function maskSecrets(text: string): string {
  let out = text;
  for (const secret of [
    config.openaiApiKey,
    config.googleClientSecret,
    config.googleRefreshToken,
    config.sessionSecret,
    config.lineChannelSecret,
    config.lineChannelAccessToken,
  ]) {
    if (secret && secret.length > 4) out = out.split(secret).join("***");
  }
  return out;
}
