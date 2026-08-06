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

/** AI抽出結果のスキーマ(AIには必ずこのJSONで出力させる) */
export const extractedCandidateSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  event_type: z.string().nullable(),
  title: z.string().nullable(), // 現場名
  client_name: z.string().nullable(), // 元請名
  requester_name: z.string().nullable(), // 依頼者名
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(), // 確定できない場合はnull(推測禁止)
  date_candidates: z.array(z.string()).default([]), // 「火曜日」等から計算した候補日
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  all_day: z.boolean().default(false),
  meeting_time: z.string().nullable(), // 集合時間
  meeting_place: z.string().nullable(), // 集合場所
  address: z.string().nullable(), // 現場住所
  work_description: z.string().nullable(), // 作業内容
  workers: z.number().int().nullable(), // 必要人数
  assignee: z.string().nullable(), // 担当者
  items: z.string().nullable(), // 持ち物
  vehicles: z.string().nullable(), // 必要車両
  cautions: z.string().nullable(), // 注意事項
  notes: z.array(z.string()).default([]), // 備考
  is_tentative: z.boolean().default(false),
  change_type: z.enum(["new", "change", "cancel"]).default("new"),
  missing_fields: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  source_text: z.string(),
});

export type ExtractedCandidate = z.infer<typeof extractedCandidateSchema>;

export const extractionResultSchema = z.object({
  candidates: z.array(extractedCandidateSchema),
});
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
