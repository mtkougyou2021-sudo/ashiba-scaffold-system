import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import { config } from "../config";
import { requireLogin } from "../middleware/auth";
import { getSettings } from "../services/settingsService";

export const setupRouter = Router();

export interface SetupCheck {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

/**
 * 準備状況の確認。
 * 値そのものは絶対に画面へ出さず、設定済みかどうかだけを表示する。
 */
function buildChecks(): SetupCheck[] {
  const usingOpenAI = config.aiProvider === "openai" && !!config.openaiApiKey;
  const usingRealCalendar = config.calendarMode === "real";
  return [
    {
      key: "OPENAI_API_KEY",
      label: "AI解析(OpenAI)",
      ok: usingOpenAI,
      hint: usingOpenAI
        ? "本番のAIで解析しています"
        : "未設定のため開発用の簡易解析で動いています。手順02を行ってください",
    },
    {
      key: "GOOGLE_CLIENT_ID",
      label: "GoogleクライアントID",
      ok: !!config.googleClientId,
      hint: config.googleClientId ? "設定済み" : "手順3-4で取得してください",
    },
    {
      key: "GOOGLE_CLIENT_SECRET",
      label: "Googleクライアントシークレット",
      ok: !!config.googleClientSecret,
      hint: config.googleClientSecret ? "設定済み" : "手順3-4で取得してください",
    },
    {
      key: "GOOGLE_REFRESH_TOKEN",
      label: "Google許可トークン",
      ok: !!config.googleRefreshToken,
      hint: config.googleRefreshToken ? "設定済み" : "手順3-5で取得してください",
    },
    {
      key: "GOOGLE_CALENDAR_MODE",
      label: "カレンダー登録",
      ok: usingRealCalendar,
      hint: usingRealCalendar
        ? "実際のGoogleカレンダーへ登録します"
        : "動作確認モードです。実際には登録されません(real に変更すると本番登録)",
    },
  ];
}

setupRouter.get("/setup", requireLogin, ah(async (_req, res) => {
  const checks = buildChecks();
  const settings = await getSettings();
  res.render("setup", {
    checks,
    readyCount: checks.filter((c) => c.ok).length,
    calendarId: settings.calendarId,
  });
}));
