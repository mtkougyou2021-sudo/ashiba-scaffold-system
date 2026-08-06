# AI予定管理秘書システム(株式会社MT興業)

LINE・PDF・画像・メール等から予定候補をAIで抽出し、**代表者が承認したものだけ**をGoogleカレンダーへ登録するシステム。

- AIは予定を勝手にカレンダーへ登録しません(承認必須)
- AIは不明な日付・時刻を推測して確定しません(情報不足として確認待ちに)

設計書: [docs/DESIGN.md](docs/DESIGN.md)

## 現在の実装状況

- ✅ **第1段階**: 管理画面から文章入力 → AI抽出 → 承認画面 → 承認後にGoogleカレンダー登録
- ⬜ 第2段階: PDF・画像アップロード解析
- ⬜ 第3段階: LINE公式アカウント連携
- ⬜ 第4段階: 変更・中止・重複判定
- ⬜ 第5段階: Gmail・工程表・出面管理連携

## セットアップ(開発)

```bash
cd schedule-secretary
npm install
cp .env.example .env   # 編集(開発は AI_PROVIDER=mock / GOOGLE_CALENDAR_MODE=mock でOK)
npx prisma db push     # PostgreSQLにテーブル作成
npm run seed           # 承認者ユーザー作成(ADMIN_EMAIL / ADMIN_PASSWORD)
npm run dev            # http://localhost:3000
```

## テスト

```bash
npm run test:ai   # 仕様の必須テスト8件(DB不要)
```

## 本番(Railway)

Root Directory を `schedule-secretary` にしてDockerfileでデプロイ。必要な環境変数は `.env.example` と設計書 §7 を参照。
起動時に `prisma db push` と `seed` が自動実行されます。
