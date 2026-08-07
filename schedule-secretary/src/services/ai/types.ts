import { z } from "zod";

/** AI判定分類 */
export const CLASSIFICATIONS = [
  "approval_pending", // 承認待ち
  "insufficient", // 情報不足
  "tentative", // 仮予定
  "change_candidate", // 変更候補
  "cancel_candidate", // 中止候補
  "out_of_scope", // 対象外
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  approval_pending: "承認待ち",
  insufficient: "情報不足",
  tentative: "仮予定",
  change_candidate: "変更候補",
  cancel_candidate: "中止候補",
  out_of_scope: "対象外",
};

/** 予定の種類 */
export const EVENT_TYPES = [
  "現調",
  "足場組立",
  "足場解体",
  "打合せ",
  "材料搬入",
  "見積期限",
  "電話",
  "職人配置",
  "プラント定修",
  "橋梁工事",
  "工場保全",
  "元請との約束",
  "その他",
] as const;

/*
 * AIの出力は毎回わずかに揺れる(空配列の代わりにnull、"9:00"のような時刻表記、
 * 人数を文字列で返す等)。厳密に弾くと解析全体が失敗してしまうため、
 * 受け取れる形は受け取って正規化する。
 * ただし「不明な値を推測で埋める」ことはせず、読み取れないものはnullにする。
 */

/** 文字列。空文字はnull扱い */
const nullableStr = z
  .unknown()
  .transform((v) => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s === "" || s === "null" ? null : s;
  });

/** 文字列配列。null・単一文字列・オブジェクト混在でも配列に整える */
const stringArray = z.unknown().transform((v): string[] => {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => (typeof x === "string" ? x.trim() : x === null || x === undefined ? "" : String(x)))
    .filter((s) => s !== "");
});

const boolDefault = (fallback: boolean) =>
  z.unknown().transform((v) => (typeof v === "boolean" ? v : fallback));

/** YYYY-MM-DD 以外はnull(推測で補完しない) */
const dateStr = z.unknown().transform((v) => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
});

/** "9:00" も "09:00" も受け取り HH:MM に揃える */
const timeStr = z.unknown().transform((v) => {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
});

/** 人数。"4" や "4人" でも数値にする */
const intOrNull = z.unknown().transform((v) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const m = v.match(/\d+/);
    if (m) return Number(m[0]);
  }
  return null;
});

/** 日付候補は YYYY-MM-DD のものだけ残す */
const dateArray = stringArray.transform((arr) => arr.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)));

const classificationField = z.unknown().transform((v): Classification => {
  const s = typeof v === "string" ? v.trim() : "";
  return (CLASSIFICATIONS as readonly string[]).includes(s) ? (s as Classification) : "insufficient";
});

const changeTypeField = z.unknown().transform((v): "new" | "change" | "cancel" => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "change" || s === "cancel" ? s : "new";
});

const confidenceField = z.unknown().transform((v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
});

/** AI抽出結果のスキーマ(AIには必ずこのJSONで出力させる) */
export const extractedCandidateSchema = z.object({
  classification: classificationField,
  event_type: nullableStr,
  title: nullableStr, // 現場名
  client_name: nullableStr, // 元請名
  requester_name: nullableStr, // 依頼者名
  date: dateStr, // 確定できない場合はnull(推測禁止)
  date_candidates: dateArray, // 「火曜日」等から計算した候補日
  start_time: timeStr,
  end_time: timeStr,
  all_day: boolDefault(false),
  meeting_time: nullableStr, // 集合時間
  meeting_place: nullableStr, // 集合場所
  address: nullableStr, // 現場住所
  work_description: nullableStr, // 作業内容
  workers: intOrNull, // 必要人数
  assignee: nullableStr, // 担当者
  items: nullableStr, // 持ち物
  vehicles: nullableStr, // 必要車両
  cautions: nullableStr, // 注意事項
  notes: stringArray, // 備考
  is_tentative: boolDefault(false),
  change_type: changeTypeField,
  missing_fields: stringArray,
  confidence: confidenceField,
  source_text: z.unknown().transform((v) => (typeof v === "string" ? v : "")),
});

export type ExtractedCandidate = z.infer<typeof extractedCandidateSchema>;

/** candidates が無い/nullの場合や、単一候補が直接返ってきた場合も受け取る */
export const extractionResultSchema = z
  .unknown()
  .transform((v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (Array.isArray(obj.candidates)) return { candidates: obj.candidates };
      if (obj.candidates === null || obj.candidates === undefined) {
        // 候補配列が無く、単一候補がそのまま返ってきた形に対応
        return { candidates: "classification" in obj || "date" in obj ? [obj] : [] };
      }
      return { candidates: [obj.candidates] };
    }
    if (Array.isArray(v)) return { candidates: v };
    return { candidates: [] };
  })
  .pipe(z.object({ candidates: z.array(extractedCandidateSchema) }));

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export interface ExtractorInput {
  text: string;
  receivedAt: Date; // 相対日付(「火曜日」等)の候補日計算の基準
  senderName?: string;
}

export interface Extractor {
  extract(input: ExtractorInput): Promise<ExtractionResult>;
}

/** 空の候補の雛形 */
export function emptyCandidate(sourceText: string): ExtractedCandidate {
  return {
    classification: "insufficient",
    event_type: null,
    title: null,
    client_name: null,
    requester_name: null,
    date: null,
    date_candidates: [],
    start_time: null,
    end_time: null,
    all_day: false,
    meeting_time: null,
    meeting_place: null,
    address: null,
    work_description: null,
    workers: null,
    assignee: null,
    items: null,
    vehicles: null,
    cautions: null,
    notes: [],
    is_tentative: false,
    change_type: "new",
    missing_fields: [],
    confidence: 0,
    source_text: sourceText,
  };
}
