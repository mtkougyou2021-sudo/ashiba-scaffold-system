# AI予定管理秘書システム 設計書

株式会社MT興業向け — LINE・PDF・画像・メール等から予定候補を抽出し、**代表者が承認したものだけ**をGoogleカレンダーへ登録するシステム。

## 0. 最重要原則

1. **AIは予定をGoogleカレンダーへ勝手に登録しない。** 登録は承認者の「承認」操作があった場合のみ実行する。
2. **AIは不明な情報を推測して確定しない。** 日付・時刻・場所・内容が読み取れない場合は `null` とし、`missing_fields` に列挙して「情報不足」「確認待ち」として扱う。
3. 変更・中止と思われる情報も、承認者の確認なしに既存予定を書き換え・削除しない。
4. 完全自動化よりも **誤登録の防止を最優先** とする。

---

## 1. システム構成

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ LINE公式アカウント│   │  管理画面        │   │   Gmail       │
│ (第3段階)      │   │ (第1段階〜)      │   │  (第5段階)     │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │ Webhook          │ HTTPS            │ API
       ▼                  ▼                  ▼
┌─────────────────────────────────────────────────┐
│              アプリケーションサーバー (Node.js/Express)   │
│                                                 │
│  受信処理 → AI解析(OpenAI) → 予定候補作成(承認待ち)      │
│                     │                           │
│              承認画面(スマホ対応)                     │
│         承認/修正/拒否/保留/備考追加                   │
│                     │ 承認時のみ                   │
│              Google Calendar API                │
└───────────────┬─────────────────────────────────┘
                ▼
         PostgreSQL (Prisma)
```

- ホスティング: Railway(Docker)。既存のRailway/PostgreSQL環境へ統合しやすいよう、単一のExpressアプリ+Prismaで構成。
- ファイルストレージ: 第2段階でアップロードされるPDF/画像はサーバーローカル(`storage/`)へ保存し、認証必須のルート経由でのみ配信。将来S3等へ差し替え可能なようパスをDBに保存。

### AI解析プロバイダ

- 本番: OpenAI API(JSONモード、温度0)。出力は必ずJSONスキーマに従わせる。
- 開発/フォールバック: `AI_PROVIDER=mock` でルールベース解析器を使用。APIキー無しで動作確認・テストが可能。OpenAI呼び出し失敗時は元データを保持し「再解析」ボタンで再実行できる。

---

## 2. 画面一覧

| # | 画面 | パス | 段階 | 内容 |
|---|------|------|------|------|
| 1 | ログイン | `/login` | 1 | メール+パスワード認証 |
| 2 | ダッシュボード | `/` | 1 | 各件数、本日/明日/今週の予定、最近の登録、処理エラー |
| 3 | 文章入力 | `/messages/new` | 1 | 管理画面から文章を入力してAI解析 |
| 4 | 承認待ち一覧 | `/candidates?status=pending` | 1 | 承認/修正/拒否/保留/備考ボタン |
| 5 | 情報不足一覧 | `/candidates?status=insufficient` | 1 | 不足項目を表示、補完して承認可能 |
| 6 | 仮予定一覧 | `/candidates?status=tentative` | 1 | 確定したら承認 |
| 7 | 変更候補一覧 | `/candidates?status=change_candidate` | 4 | 現予定との比較表示 |
| 8 | 中止候補一覧 | `/candidates?status=cancel_candidate` | 4 | 承認時のみ削除/キャンセル |
| 9 | 承認済み一覧 | `/candidates?status=approved` | 1 | 登録結果とカレンダーリンク |
| 10 | 拒否一覧 | `/candidates?status=rejected` | 1 | 拒否理由と履歴(削除しない) |
| 11 | 候補詳細・編集 | `/candidates/:id` | 1 | 全項目編集、承認/修正/拒否/備考/保留 |
| 12 | カレンダー登録履歴 | `/history` | 1 | 登録/更新/削除の履歴 |
| 13 | PDF・画像アップロード | `/uploads` | 2 | ファイル→OCR/表解析→候補一覧→一括承認 |
| 14 | 設定 | `/settings` | 1 | 通知時刻、色分け、カレンダーID等 |

全画面スマートフォン対応(レスポンシブ、44px以上のタップ領域、1カラムレイアウト)。

---

## 3. データベース設計 (PostgreSQL / Prisma)

### users
| 列 | 型 | 説明 |
|----|----|------|
| id | serial PK | |
| email | text unique | ログインID |
| password_hash | text | bcrypt |
| name | text | 表示名 |
| role | text | `approver`(承認者=代表者) / `viewer` |
| created_at | timestamptz | |

### messages(受信情報)
| 列 | 型 | 説明 |
|----|----|------|
| id | serial PK | |
| source | text | `admin_text` / `admin_upload` / `line` / `gmail` |
| sender_name | text? | 送信元(LINE表示名等) |
| raw_text | text? | 元の文章 |
| received_at | timestamptz | 受信日時 |
| status | text | `received` / `analyzed` / `analyze_error` |
| created_at | timestamptz | |

### attachments(添付: 第2段階〜)
id, message_id FK?, filename, mime_type, storage_path, size, uploaded_by_id?, ocr_text?, created_at

### schedule_candidates(予定候補) — 中核テーブル
| 列 | 型 | 説明 |
|----|----|------|
| id | serial PK | |
| message_id | FK? | 元データ(メッセージ) |
| attachment_id | FK? | 元データ(PDF/画像) |
| source_text | text | 元の文章(抜粋) |
| extracted_data | jsonb | AI抽出結果(修正前データ。全項目のJSON) |
| modified_data | jsonb? | 承認者の修正後データ |
| ai_classification | text | AI判定(下記6分類) |
| confidence | float? | AIの信頼度 0〜1 |
| missing_fields | jsonb | 不足している情報の配列 |
| is_tentative | bool | 仮予定か |
| change_type | text | `new` / `change` / `cancel` |
| status | text | 下記ステータス |
| approved_by_id | FK? | 承認者 |
| approved_at | timestamptz? | 承認日時 |
| reject_reason | text? | 拒否理由 |
| google_event_id | text? | 登録されたGoogleイベントID |
| related_event_id | FK? | 変更/中止対象の calendar_events.id |
| created_at / updated_at | | |

**AI判定(ai_classification)**: `approval_pending`(承認待ち) / `insufficient`(情報不足) / `tentative`(仮予定) / `change_candidate`(変更候補) / `cancel_candidate`(中止候補) / `out_of_scope`(対象外)

**ステータス(status)**: `pending` / `insufficient` / `tentative` / `change_candidate` / `cancel_candidate` / `out_of_scope` / `approved` / `rejected` / `on_hold` / `register_error`

**extracted_data のJSON構造**(AI出力形式と同一):
```json
{
  "classification": "approval_pending",
  "event_type": "現調",
  "title": "港区〇〇工場",
  "client_name": "〇〇建設",
  "requester_name": null,
  "date": "2026-08-10",
  "date_candidates": [],
  "start_time": "09:00",
  "end_time": null,
  "all_day": false,
  "meeting_time": null,
  "meeting_place": null,
  "address": "名古屋市港区",
  "work_description": "現場確認",
  "workers": null,
  "assignee": null,
  "items": null,
  "vehicles": null,
  "cautions": null,
  "notes": [],
  "is_tentative": false,
  "change_type": "new",
  "missing_fields": [],
  "confidence": 0.92,
  "source_text": "8月10日9時に港区〇〇工場で現調お願いします"
}
```

### calendar_events(Googleカレンダー登録記録)
id, candidate_id FK?, google_event_id, calendar_id, title, start_at, end_at, all_day, status(`registered`/`updated`/`cancelled`/`deleted`/), registered_by_id FK, created_at, updated_at

### approval_logs(操作履歴)
id, user_id FK, candidate_id FK?, action(`approve`/`modify`/`reject`/`hold`/`add_note`/`calendar_register`/`calendar_update`/`calendar_delete`/`reanalyze`), detail jsonb, created_at

### system_settings
key(PK), value(jsonb), updated_at
— 通知既定値、種類別色分け、カレンダーID、AIモデル名など。

### error_logs
id, context, message, detail jsonb, created_at
— **APIキー等の秘密情報は記録しない**(記録前にマスク)。

---

## 4. 処理フロー

### 第1段階(本実装)
```
管理画面で文章入力
  → messages に保存 (source=admin_text)
  → AI解析 (OpenAI JSONモード / mock)
  → 候補ごとに schedule_candidates 作成(AI判定に応じたstatus)
  → 一覧・詳細画面に表示
  → 承認者が [承認/修正/拒否/保留/備考追加]
      承認 → Google Calendar API insert
              成功: status=approved, calendar_events作成, approval_logs記録, 完了表示(予定名/日時/カレンダー/リンク/承認者/承認日時)
              失敗: status=register_error, error_logs記録, 「再登録」ボタン表示
      修正 → modified_data 保存(修正前データは extracted_data に保持)
      拒否 → status=rejected + 拒否理由。削除せず履歴保存
      保留 → status=on_hold
      備考 → notes[] へ追加。承認時にカレンダー説明欄へ記載
```

- AI解析失敗時: messages.status=analyze_error として元データを保持、「再解析」で再実行。
- 対象外(雑談等)は候補を `out_of_scope` として記録のみ(登録しない)。

### 承認時のGoogleカレンダー登録内容
- 予定名: `【予定区分】現場名／作業内容`(例: 【現調】港区〇〇工場／現場確認)
- 説明欄: 元請名/現場名/住所/担当者/人数/集合時間/作業内容/持ち物/注意事項/備考/元情報/承認日時
- 通知(初期値・設定で変更可): 前日18時、開始1時間前
- 色: 予定の種類ごとに設定画面で指定(GoogleカレンダーcolorId 1〜11)

### 第2段階以降(概要)
- 第2段階: PDF/画像アップロード → OCR/表解析(OpenAI Vision) → 行ごとに候補作成 → 一覧表示 → 1件/選択/全件承認(低信頼度は一括承認から除外)。読めない部分は「読み取り不能」表示。
- 第3段階: LINE Messaging API Webhook(署名検証必須) → 文章/PDF/画像取得 → 解析 → 承認者へLINEプッシュで承認依頼 → 管理画面で承認。
- 第4段階: 変更候補(比較表示→承認時のみ既存イベント更新)、中止候補(承認時のみ削除/キャンセル)、重複判定(日付・時間・現場名・住所・作業内容・元請名の類似で警告)。
- 第5段階: Gmail連携、工程表・出面管理連携。

---

## 5. フォルダ構成

```
schedule-secretary/
├── docs/DESIGN.md            # 本書
├── prisma/schema.prisma      # DBスキーマ
├── src/
│   ├── index.ts              # サーバー起動・ルーティング登録
│   ├── config.ts             # 環境変数の読込・検証
│   ├── db.ts                 # Prismaクライアント
│   ├── middleware/auth.ts    # 認証・承認者権限チェック
│   ├── services/
│   │   ├── ai/
│   │   │   ├── types.ts          # 抽出JSONスキーマ・分類定義
│   │   │   ├── openaiExtractor.ts# OpenAI JSONモード解析
│   │   │   ├── mockExtractor.ts  # ルールベース解析(開発用フォールバック)
│   │   │   └── index.ts          # プロバイダ選択
│   │   ├── calendar/googleCalendar.ts # Calendar API(insert/update/delete)
│   │   ├── candidateService.ts   # 候補作成・承認・拒否等の業務ロジック
│   │   └── settingsService.ts    # system_settings 読み書き
│   ├── routes/               # auth / dashboard / messages / candidates / settings / history
│   ├── views/                # EJSテンプレート(スマホ対応)
│   └── utils/
├── public/css/style.css
├── scripts/
│   ├── seed.ts               # 承認者ユーザー・初期設定投入
│   └── test-ai.ts            # 必須テスト8件の実行
├── Dockerfile
├── .env.example
└── package.json
```

---

## 6. 必要な外部サービスとAPI

| サービス | 用途 | 段階 |
|---------|------|------|
| OpenAI API | 文章/画像からの予定候補抽出(JSON出力) | 1〜 |
| Google Calendar API (OAuth2) | 承認済み予定の登録・更新・削除 | 1〜 |
| LINE Messaging API | 受信Webhook・承認通知プッシュ | 3 |
| Gmail API | メール取込 | 5 |
| Railway / PostgreSQL | ホスティング・DB | 1〜 |

Google認証は OAuth2(リフレッシュトークン方式)。代表者のGoogleアカウントで一度認可し、リフレッシュトークンを環境変数へ保存する。

---

## 7. 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `DATABASE_URL` | ✔ | PostgreSQL接続文字列 |
| `SESSION_SECRET` | ✔ | セッション署名鍵 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | 初回 | 承認者ユーザーの初期作成 |
| `AI_PROVIDER` | | `openai`(既定) / `mock` |
| `OPENAI_API_KEY` | openai時 | ソースコードへ直接書かない |
| `OPENAI_MODEL` | | 既定 `gpt-4o-mini` |
| `GOOGLE_CALENDAR_MODE` | | `real`(既定) / `mock`(開発用) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | real時 | OAuth2 |
| `GOOGLE_CALENDAR_ID` | | 既定 `primary` |
| `TZ` | | `Asia/Tokyo` 固定推奨 |
| `PORT` | | 既定 3000 |
| (第3段階) `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | | Webhook署名検証に必須 |

---

## 8. セキュリティ

- APIキーは環境変数のみ。エラー表示・ログへ出力しない(マスク処理)。
- 管理画面は全ルート認証必須。カレンダー登録・承認操作は `role=approver` のみ。
- パスワードはbcryptでハッシュ化。セッションは署名付きCookie(HttpOnly, SameSite=Lax, 本番はSecure)。
- LINE Webhookは `X-Line-Signature` をチャネルシークレットで検証(第3段階)。
- 添付ファイルは認証必須ルート経由でのみ配信。直リンク不可。
- すべての承認系操作を approval_logs に記録(誰が・いつ・何を)。

---

## 9. 開発手順

1. `cd schedule-secretary && npm install`
2. `.env.example` を `.env` へコピーし編集(開発は `AI_PROVIDER=mock` `GOOGLE_CALENDAR_MODE=mock` で可)
3. PostgreSQL起動、`npx prisma db push`(または `prisma migrate deploy`)
4. `npm run seed`(承認者ユーザー・初期設定投入)
5. `npm run dev` → http://localhost:3000
6. `npm run test:ai` で必須テスト8件を実行

## 10. テスト方法

- **AI解析テスト**: `npm run test:ai`。仕様の必須テスト8文を解析し、期待分類(承認待ち/情報不足/変更候補/中止候補/対象外/複数日候補)と照合して合否を表示。
- **画面テスト**: 文章入力→候補一覧→編集→承認(mockカレンダー)→承認済み一覧・履歴表示までを手動確認。拒否・保留・備考追加・再登録も確認。
- **登録エラーテスト**: `GOOGLE_CALENDAR_MODE=real` かつ資格情報未設定で承認 → `register_error` になり再登録ボタンが出ることを確認。

## 11. 本番公開手順 (Railway)

1. RailwayでPostgreSQLプラグインを追加(既存DBがあればそれを利用)し、`DATABASE_URL` を設定。
2. 本リポジトリを接続、Root Directoryを `schedule-secretary` に設定(Dockerfileビルド)。
3. 環境変数を設定(§7)。`AI_PROVIDER=openai`、`GOOGLE_CALENDAR_MODE=real`。
4. Google Cloud ConsoleでOAuthクライアント作成 → 代表者アカウントで認可 → リフレッシュトークン取得 → 環境変数へ。
5. デプロイ時に `prisma migrate deploy && npm run seed && npm start`(Dockerfileに組込済)。
6. 独自ドメイン/HTTPSを確認し、代表者のスマートフォンでログイン確認。

## 12. 想定される誤判定と対策

| 誤判定 | 対策 |
|--------|------|
| 日付の勝手な補完(「来週どこかで」→特定日) | プロンプト/ルールで禁止。dateはnull+missing_fieldsへ。情報不足として承認前に人が補完 |
| 「火曜日」等の相対日付の誤確定 | `date_candidates` に候補日を提示するのみで `date` は確定しない。承認画面で人が選択 |
| 雑談を予定として登録 | `out_of_scope` 分類。承認フローに乗らない(記録のみ) |
| 変更連絡を新規予定として二重登録 | `change_candidate` 分類とし新規作成しない。第4段階で比較UI |
| 中止連絡での自動削除 | 自動削除は実装しない。承認時のみ削除/キャンセル |
| OCR誤読 | 信頼度を付与し低信頼度は一括承認から除外。「読み取り不能」を明示。元ファイル保持+手入力導線 |
| 同一予定の重複登録 | 日付/時間/現場名/住所/作業内容/元請名の類似で警告(第4段階) |
| 年の誤推定(「8月10日」) | 受信日から最も近い未来を候補とし、過去日になる場合は注記を付け承認画面で確認 |
| AI障害・API障害 | 元データ保持+再解析ボタン。登録失敗は register_error+再登録ボタン。承認済み扱いにしない |
