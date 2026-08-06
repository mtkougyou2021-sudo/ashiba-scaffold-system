# セットアップ手順(外部サービスの準備)

上から順に進めてください。各手順の最後に、Railwayへ登録する値が1つずつ手に入ります。
管理画面の「準備」タブ(`/setup`)でも同じリンクと設定状況を確認できます。

---

## 01. GitHub — プログラムの保存先(3分・無料・最優先)

**開く → https://github.com/apps/claude**

1. **Install**(すでに入っていれば **Configure**)を押す
2. **Only select repositories** を選び `ashiba-scaffold-system` を追加する
3. **Install** / **Save** を押す

インストール済みアプリの確認は → https://github.com/settings/installations

> Claudeアプリが未インストールだと、公開リポジトリの読み取りは通っても書き込み(push)が403で拒否されます。
> 一覧にClaudeが無ければ、設定変更ではなく**インストール**が必要です。

**手に入るもの**: プログラムの保存(値の入力なし)

---

## 02. OpenAI — 文章を読むAI(15分・従量課金)

**開く → https://platform.openai.com/api-keys**

1. アカウントを作る(初回のみ・電話番号の確認あり)
2. 先に支払い方法を登録する(最低 $5 のチャージで十分)
   → https://platform.openai.com/settings/organization/billing/overview
3. **Create new secret key** を押す(名前は `MT興業AI秘書` など)
4. 表示されたキーをコピーして控える

> ⚠️ **キーは一度しか表示されません。** 画面を閉じると二度と見られません(忘れたら作り直せます)。

**手に入るもの**: `OPENAI_API_KEY`

費用の目安: 文章1件の解析で0.1円未満。月に数百件でも数十円程度です。

---

## 03. Google — カレンダーへ書き込む許可(30分・無料)

一番手間のかかる作業です。上から順にリンクを開いてください。

### 3-1. プロジェクトを作る
**開く → https://console.cloud.google.com/projectcreate**

プロジェクト名は `mt-schedule` などで構いません。作成後、画面上部でこのプロジェクトが選ばれている状態にします。

### 3-2. カレンダー機能を有効にする
**開く → https://console.cloud.google.com/apis/library/calendar-json.googleapis.com**

**有効にする**を押すだけです。

### 3-3. 利用者の登録
**開く → https://console.cloud.google.com/apis/credentials/consent**

1. ユーザーの種類は **外部**
2. アプリ名 `MT興業 AI予定管理秘書`、連絡先に代表者のメールアドレス
3. テストユーザーに代表者のGoogleアカウントを追加
4. 最後に **「本番環境に公開」** を押す

> ⚠️ **「テスト」のままにしないでください。** テスト状態だと許可が7日で切れ、毎週カレンダー登録が止まります。「本番環境に公開」を押せば切れません(審査は不要)。

### 3-4. IDとシークレットを作る
**開く → https://console.cloud.google.com/apis/credentials**

1. **認証情報を作成 → OAuth クライアント ID**
2. 種類は **ウェブ アプリケーション**
3. **承認済みのリダイレクト URI** に次を追加する
   ```
   https://developers.google.com/oauthplayground
   ```
4. **クライアント ID** と **クライアント シークレット** を控える

> ⚠️ 3を飛ばすと次の3-5で必ずエラーになります。

### 3-5. リフレッシュトークンを受け取る
**開く → https://developers.google.com/oauthplayground**

1. 右上の歯車 → **Use your own OAuth credentials** にチェック
2. 3-4のクライアントIDとシークレットを貼り付ける
3. 左の一覧から **Calendar API v3** → `https://www.googleapis.com/auth/calendar` を選ぶ
4. **Authorize APIs** → 代表者のGoogleアカウントで許可する
5. **Exchange authorization code for tokens** → **Refresh token** を控える

### 3-6. 登録先カレンダーを決める
**開く → https://calendar.google.com/calendar/u/0/r/settings**

1. まず **テスト用カレンダーを新しく作る**(例: `AI秘書テスト`)
2. そのカレンダーの設定を開き **カレンダーID** を控える

> ⚠️ **最初は本番カレンダーに向けないでください。** 読み取り精度を確かめる間はテスト用に登録し、納得できてから切り替えます。

**手に入るもの**: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_CALENDAR_ID`

---

## 04. Railway — 動かす場所(20分・月$5〜)

**開く → https://railway.app/dashboard**

1. 既存プロジェクトに **New → GitHub Repo** で `ashiba-scaffold-system` を追加
2. Settings の **Root Directory** に `schedule-secretary` を入力
3. Variables に下の一覧を登録
4. デプロイ完了後のURLをスマホで開き、ログインできるか確認

> データベースは新規作成不要です。既存PostgreSQLの `DATABASE_URL` をそのまま使えば、必要な表が起動時に自動作成されます。

**手に入るもの**: 管理画面のURL

---

## 05. LINE — 第3段階になってから(今は不要)

- LINE Developers → https://developers.line.biz/console/
- LINE公式アカウントマネージャー → https://manager.line.biz/

第1段階を実際に使い、読み取り精度に納得できてから着手すれば十分です。

**将来使うもの**: `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`

---

## Railwayに登録する値の一覧

| 名前 | 入れる値 |
|------|---------|
| `DATABASE_URL` | 既存PostgreSQLの接続文字列 |
| `SESSION_SECRET` | 長いランダムな文字列を自分で決める |
| `ADMIN_EMAIL` | 代表者のメールアドレス(ログインID) |
| `ADMIN_PASSWORD` | ログインパスワードを自分で決める |
| `ADMIN_NAME` | 代表者のお名前 |
| `AI_PROVIDER` | `openai` |
| `OPENAI_API_KEY` | 手順02 |
| `GOOGLE_CALENDAR_MODE` | `real` |
| `GOOGLE_CLIENT_ID` | 手順3-4 |
| `GOOGLE_CLIENT_SECRET` | 手順3-4 |
| `GOOGLE_REFRESH_TOKEN` | 手順3-5 |
| `GOOGLE_CALENDAR_ID` | 手順3-6(まずはテスト用) |
| `TZ` | `Asia/Tokyo` |

---

## つまずいたときは

**カレンダー登録が「登録エラー」になる**
Googleの4つの値のどれかが違っています。承認済みにはならず再登録ボタンが出るので、値を直してから押し直せば登録されます。予定が消えることはありません。

**1週間ほどでカレンダー登録が止まった**
手順3-3の「本番環境に公開」が押せていません。押したうえで3-5をやり直し、新しいRefresh tokenに入れ替えてください。

**AIの読み取りがおかしい**
承認前なのでカレンダーには何も登録されていません。その文章と、どう読んでほしかったかを記録して調整してください。
