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
  isProduction: process.env.NODE_ENV === "production",
};

/** エラーメッセージからAPIキー等の秘密情報を除去する */
export function maskSecrets(text: string): string {
  let out = text;
  for (const secret of [config.openaiApiKey, config.googleClientSecret, config.googleRefreshToken, config.sessionSecret]) {
    if (secret && secret.length > 4) out = out.split(secret).join("***");
  }
  return out;
}
