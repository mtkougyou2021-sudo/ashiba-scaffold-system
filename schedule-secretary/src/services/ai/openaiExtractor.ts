import OpenAI from "openai";
import { config } from "../../config";
import { toDateString, formatDateJa } from "../../utils/dates";
import {
  Extractor,
  ExtractorInput,
  ExtractionResult,
  extractionResultSchema,
  emptyCandidate,
} from "./types";

const SYSTEM_PROMPT = `あなたは足場工事会社「株式会社MT興業」の予定管理秘書AIです。
受信した文章から予定候補を抽出し、必ずJSONのみで出力してください。

【絶対に守るルール】
1. 不明な日付・時刻・場所・内容を推測して確定しない。読み取れない値は null にする。
2. 「来週どこかで」のように日付を特定できない場合、date は null とし missing_fields に "日付" を入れる。
3. 「火曜日」のような曜日のみの指定は、date は null のまま、受信日から計算した次のその曜日を date_candidates に入れる(確定しない)。
4. 「朝一」「午後」など時刻が特定できない表現は start_time を null にし、missing_fields に "開始時刻" を入れ、notes にその旨を書く。
5. 挨拶や雑談など予定でない内容は classification を "out_of_scope" にする。
6. 「工程表を送ります」など添付ファイルの予告のみで実ファイルが無い場合は "out_of_scope" とし、予定を作らない。
7. 「中止」「延期」「なくなりました」「今回は無し」等は "cancel_candidate"(change_type: "cancel")。既存予定を削除する判断はしない。
8. 既存予定の「変更」の連絡は "change_candidate"(change_type: "change")。新規予定として扱わない。
9. 「たぶん」「かもしれない」「調整中」「〜の予定」など未確定の表現は is_tentative: true、classification は "tentative"。
10. 「15日から17日まで」のような複数日の予定は、1日ごとに candidates 配列の別要素に分ける。
11. 「8月10日」のように年が無い日付は、受信日から最も近い未来の年とし、notes に「年は受信日から推定(要確認)」と書く。月が無い「15日」のような日付は date を確定せず date_candidates に候補を入れる。

【classification の値】
- approval_pending: 日時・場所・内容が十分読み取れている予定
- insufficient: 日付・時刻・現場名・内容などに不足がある予定
- tentative: 未確定の表現を含む仮予定
- change_candidate: 登録済み予定の変更と考えられるもの
- cancel_candidate: 登録済み予定の中止と考えられるもの
- out_of_scope: 雑談・挨拶など予定ではない内容

【event_type の値】
現調 / 足場組立 / 足場解体 / 打合せ / 材料搬入 / 見積期限 / 電話 / 職人配置 / プラント定修 / 橋梁工事 / 工場保全 / 元請との約束 / その他

【出力形式】
{
  "candidates": [
    {
      "classification": "approval_pending",
      "event_type": "現調",
      "title": "現場名(不明ならnull)",
      "client_name": "元請名(不明ならnull)",
      "requester_name": "依頼者名(不明ならnull)",
      "date": "YYYY-MM-DD または null",
      "date_candidates": ["YYYY-MM-DD"],
      "start_time": "HH:MM または null",
      "end_time": "HH:MM または null",
      "all_day": false,
      "meeting_time": "集合時間(不明ならnull)",
      "meeting_place": "集合場所(不明ならnull)",
      "address": "現場住所(不明ならnull)",
      "work_description": "作業内容(不明ならnull)",
      "workers": 4,
      "assignee": "担当者(不明ならnull)",
      "items": "持ち物(不明ならnull)",
      "vehicles": "必要車両(不明ならnull)",
      "cautions": "注意事項(不明ならnull)",
      "notes": ["補足"],
      "is_tentative": false,
      "change_type": "new",
      "missing_fields": ["不足している項目名"],
      "confidence": 0.92,
      "source_text": "元の文章"
    }
  ]
}
予定でない場合も candidates に1件(out_of_scope)を入れて返してください。JSON以外の文章は一切出力しないでください。

【出力上の注意】
- 配列の項目(date_candidates / notes / missing_fields)に該当が無い場合は、null ではなく空配列 [] を入れてください。
- 時刻は "09:00" のように2桁で書いてください。
- workers は数値で書いてください(例: 4)。単位は付けないでください。
- candidates は必ず配列にしてください。`;

export class OpenAIExtractor implements Extractor {
  private client: OpenAI;

  constructor() {
    if (!config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY が設定されていません(AI_PROVIDER=mock で開発用解析器を使用できます)");
    }
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    const received = input.receivedAt;
    const userPrompt = [
      `受信日時: ${formatDateJa(toDateString(received))} ${received.toTimeString().slice(0, 5)}`,
      input.senderName ? `送信元: ${input.senderName}` : null,
      "文章:",
      input.text,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await this.client.chat.completions.create({
      model: config.openaiModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error("AIから応答がありませんでした");

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new Error("AIの応答をJSONとして読み取れませんでした");
    }

    const parsed = extractionResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`AI出力がスキーマに適合しません: ${parsed.error.message.slice(0, 500)}`);
    }

    // 候補が1件も返らなかった場合は、元データを失わないよう確認待ちの1件を作る
    if (parsed.data.candidates.length === 0) {
      const fallback = emptyCandidate(input.text);
      fallback.classification = "insufficient";
      fallback.missing_fields = ["日付", "内容"];
      fallback.notes = ["AIが予定候補を抽出できませんでした。内容を確認して手入力してください。"];
      fallback.confidence = 0;
      return { candidates: [fallback] };
    }

    // source_text が空なら元文章で補完
    for (const c of parsed.data.candidates) {
      if (!c.source_text) c.source_text = input.text;
    }
    return parsed.data;
  }
}
