import dotenv from "dotenv";
dotenv.config();

/**
 * 環境変数の値を取り出す。
 * 管理画面から貼り付けると前後に改行や空白が混入しやすく、
 * URLに改行が入るとLINEがカードごと拒否する、トークンが認証に失敗する等の
 * 原因が非常に分かりにくい不具合になるため、必ず除去する。
 */
function env(name: string, fallback = ""): string {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  const trimmed = v.trim();
  return trimmed === "" ? fallback : trimmed;
}

export const config = {
  port: Number(env("PORT", "3000")),
  sessionSecret: env("SESSION_SECRET"),
  aiProvider: env("AI_PROVIDER", "openai") as "openai" | "mock",
  openaiApiKey: env("OPENAI_API_KEY"),
  openaiModel: env("OPENAI_MODEL", "gpt-4o-mini"),
  calendarMode: env("GOOGLE_CALENDAR_MODE", "real") as "real" | "mock",
  googleClientId: env("GOOGLE_CLIENT_ID"),
  googleClientSecret: env("GOOGLE_CLIENT_SECRET"),
  googleRefreshToken: env("GOOGLE_REFRESH_TOKEN"),
  googleCalendarId: env("GOOGLE_CALENDAR_ID", "primary"),
  // LINE連携(第3段階)
  lineChannelSecret: env("LINE_CHANNEL_SECRET"),
  lineChannelAccessToken: env("LINE_CHANNEL_ACCESS_TOKEN"),
  lineApproverUserId: env("LINE_APPROVER_USER_ID"),
  // 承認画面へのリンクを作るための公開URL(末尾のスラッシュは付けない)
  appBaseUrl: env("APP_BASE_URL").replace(/\/+$/, ""),
  isProduction: env("NODE_ENV") === "production",
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
