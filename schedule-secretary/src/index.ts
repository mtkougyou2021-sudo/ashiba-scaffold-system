import express from "express";
import cookieSession from "cookie-session";
import path from "path";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { messagesRouter } from "./routes/messages";
import { candidatesRouter } from "./routes/candidates";
import { settingsRouter } from "./routes/settings";
import { setupRouter } from "./routes/setup";
import { STATUS_LABELS } from "./services/candidateService";
import { CLASSIFICATION_LABELS, EVENT_TYPES } from "./services/ai";
import { formatDateJa } from "./utils/dates";

if (!config.sessionSecret) {
  console.error("環境変数 SESSION_SECRET が設定されていません");
  process.exit(1);
}

const app = express();

// 実行ディレクトリ(schedule-secretary/)基準。開発(tsx)・本番(Docker)共通
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "src", "views"));
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static(path.join(process.cwd(), "public")));
app.use(
  cookieSession({
    name: "session",
    secret: config.sessionSecret,
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: 7 * 24 * 3600 * 1000,
  })
);

// テンプレート共通ヘルパー
app.use((_req, res, next) => {
  res.locals.STATUS_LABELS = STATUS_LABELS;
  res.locals.CLASSIFICATION_LABELS = CLASSIFICATION_LABELS;
  res.locals.EVENT_TYPES = EVENT_TYPES;
  res.locals.formatDateJa = formatDateJa;
  res.locals.fmtDateTime = (d: Date) =>
    d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  next();
});

app.use(authRouter);
app.use(dashboardRouter);
app.use(messagesRouter);
app.use(candidatesRouter);
app.use(settingsRouter);
app.use(setupRouter);

app.use((_req, res) => {
  res.status(404).render("error", { title: "ページが見つかりません", message: "URLをご確認ください。" });
});

// 予期しないエラー(APIキー等はconfig.maskSecretsで除去済みのメッセージのみ表示)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).render("error", { title: "エラーが発生しました", message: "処理中にエラーが発生しました。時間をおいて再度お試しください。" });
});

app.listen(config.port, () => {
  console.log(`AI予定管理秘書システム 起動: http://localhost:${config.port}`);
  console.log(`AI解析: ${config.aiProvider === "openai" && config.openaiApiKey ? "OpenAI" : "ルールベース(開発用)"} / カレンダー: ${config.calendarMode}`);
});
