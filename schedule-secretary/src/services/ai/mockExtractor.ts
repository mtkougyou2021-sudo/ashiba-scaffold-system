/**
 * ルールベース解析器(開発用フォールバック)
 *
 * OpenAI APIキーが無い環境でも動作確認できるようにするための簡易解析器。
 * 本番では openaiExtractor を使用する。
 * 原則はAIと同じ: 不明な日付・時刻を推測して確定しない。
 */
import {
  Extractor,
  ExtractorInput,
  ExtractionResult,
  ExtractedCandidate,
  emptyCandidate,
} from "./types";
import {
  normalizeDigits,
  nearestFutureDate,
  nearestFutureDayOfMonth,
  nextWeekday,
  toDateString,
} from "../../utils/dates";

const EVENT_TYPE_RULES: Array<{ type: string; pattern: RegExp; work: string }> = [
  { type: "現調", pattern: /現調|現場確認|現場を見て|現場見て|下見/, work: "現場確認" },
  { type: "足場解体", pattern: /解体/, work: "足場解体" },
  { type: "足場組立", pattern: /組立|組み立て|足場設置/, work: "足場組立" },
  { type: "打合せ", pattern: /打合せ|打ち合わせ|打合わせ|ミーティング/, work: "打合せ" },
  { type: "材料搬入", pattern: /搬入/, work: "材料搬入" },
  { type: "見積期限", pattern: /見積/, work: "見積提出" },
  { type: "電話", pattern: /電話/, work: "電話連絡" },
  { type: "プラント定修", pattern: /定修/, work: "プラント定修" },
  { type: "橋梁工事", pattern: /橋梁/, work: "橋梁工事" },
  { type: "工場保全", pattern: /保全/, work: "工場保全" },
];

const CANCEL_PATTERN = /中止|延期|なくなりました|無くなりました|キャンセル|今回は\s*(無し|なし)/;
const CHANGE_PATTERN = /変更|に変えて|ずらして/;
const TENTATIVE_PATTERN = /たぶん|多分|かもしれない|かもです|調整中|未定|仮予定|になりそう/;
const GREETING_PATTERN = /お疲れ様|お疲れさま|おはよう|お世話になり|よろしくお願いします/;
const ATTACHMENT_PROMISE_PATTERN = /(工程表|図面|資料|見積書|請求書)[^。]{0,10}(送ります|送付|送る|お送り)/;

export class MockExtractor implements Extractor {
  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    const raw = input.text.trim();
    const text = normalizeDigits(raw);
    const base = input.receivedAt;

    // 添付ファイルの予告のみ(実ファイルなし)→ 予定登録しない
    if (ATTACHMENT_PROMISE_PATTERN.test(text)) {
      const c = emptyCandidate(raw);
      c.classification = "out_of_scope";
      c.notes = ["添付ファイルの送付予告のみのため予定登録しません。ファイル受信時に解析します。"];
      c.confidence = 0.9;
      return { candidates: [c] };
    }

    const eventRule = EVENT_TYPE_RULES.find((r) => r.pattern.test(text));
    const dates = extractDates(text, base);
    const times = extractTimes(text);
    const workers = extractWorkers(text);

    // 予定の要素が無い挨拶・雑談 → 対象外
    const hasScheduleSignal = !!eventRule || dates.confirmed.length > 0 || dates.candidates.length > 0 || times.start !== null;
    if (!hasScheduleSignal && (GREETING_PATTERN.test(text) || text.length < 60)) {
      const c = emptyCandidate(raw);
      c.classification = "out_of_scope";
      c.notes = ["予定に関する内容が含まれていないため対象外と判定しました。"];
      c.confidence = 0.85;
      return { candidates: [c] };
    }

    const isCancel = CANCEL_PATTERN.test(text);
    const isChange = !isCancel && CHANGE_PATTERN.test(text);
    const isTentative = TENTATIVE_PATTERN.test(text);

    // 複数日(範囲)は1日ずつ候補に分ける。日付が無い場合も1件は作る。
    const dateSlots: Array<{ date: string | null; candidates: string[]; note?: string }> = [];
    if (dates.confirmed.length > 0) {
      for (const d of dates.confirmed) dateSlots.push({ date: d.date, candidates: [], note: d.note });
    } else if (dates.candidates.length > 0) {
      for (const d of dates.candidates) dateSlots.push({ date: null, candidates: [d.date], note: d.note });
    } else {
      dateSlots.push({ date: null, candidates: [] });
    }

    const candidates: ExtractedCandidate[] = dateSlots.map((slot) => {
      const c = emptyCandidate(raw);
      c.event_type = eventRule ? eventRule.type : null;
      c.work_description = eventRule ? eventRule.work : null;
      c.title = extractSiteName(text);
      c.client_name = extractClientName(text);
      c.address = extractAddress(text);
      c.date = slot.date;
      c.date_candidates = slot.candidates;
      c.start_time = times.start;
      c.end_time = times.end;
      c.workers = workers;
      c.is_tentative = isTentative;
      if (slot.note) c.notes.push(slot.note);
      if (times.note) c.notes.push(times.note);

      const missing: string[] = [];
      if (!c.date && c.date_candidates.length === 0) missing.push("日付");
      if (!c.date && c.date_candidates.length > 0) missing.push("日付(候補あり・要確認)");
      if (!c.start_time) missing.push("開始時刻");
      if (!c.title && !c.address) missing.push("現場名");
      if (!c.event_type) missing.push("作業内容");
      c.missing_fields = missing;

      if (isCancel) {
        c.classification = "cancel_candidate";
        c.change_type = "cancel";
        c.notes.push("中止・延期の連絡と判定。登録済み予定の確認が必要です(自動削除はしません)。");
      } else if (isChange) {
        c.classification = "change_candidate";
        c.change_type = "change";
        c.notes.push("既存予定の変更連絡と判定。対象予定の確認が必要です(新規登録はしません)。");
      } else if (isTentative) {
        c.classification = "tentative";
      } else if (missing.length === 0 || (c.date && c.start_time && (c.title || c.address))) {
        c.classification = "approval_pending";
      } else {
        c.classification = "insufficient";
      }

      let conf = 0.95 - missing.length * 0.15;
      if (isTentative) conf -= 0.1;
      c.confidence = Math.max(0.3, Math.min(0.95, Math.round(conf * 100) / 100));
      return c;
    });

    return { candidates };
  }
}

interface DateHit {
  date: string;
  note?: string;
}

function extractDates(
  text: string,
  base: Date
): { confirmed: DateHit[]; candidates: DateHit[] } {
  const confirmed: DateHit[] = [];
  const candidates: DateHit[] = [];

  // 「M月D日からE日(まで)」の範囲
  let m = text.match(/(\d{1,2})月(\d{1,2})日から(?:(\d{1,2})月)?(\d{1,2})日/);
  if (m) {
    const month = Number(m[1]);
    const from = Number(m[2]);
    const toMonth = m[3] ? Number(m[3]) : month;
    const to = Number(m[4]);
    pushRange(confirmed, base, month, from, toMonth, to, "年は受信日から推定(要確認)");
    return { confirmed, candidates };
  }

  // 「D日からE日(まで)」の範囲(月なし → 候補扱い)
  m = text.match(/(\d{1,2})日から(\d{1,2})日/);
  if (m) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    const first = nearestFutureDayOfMonth(base, from);
    const month = Number(first.split("-")[1]);
    pushRange(candidates, base, month, from, month, to, "月の記載なし。受信日から候補日を計算(要確認)");
    return { confirmed, candidates };
  }

  // 「M月D日」
  m = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) {
    confirmed.push({
      date: nearestFutureDate(base, Number(m[1]), Number(m[2])),
      note: "年は受信日から推定(要確認)",
    });
    return { confirmed, candidates };
  }

  // 「D日」(月なし → 候補扱い。推測で確定しない)
  m = text.match(/(?<![月\d])(\d{1,2})日(?![間分])/);
  if (m) {
    candidates.push({
      date: nearestFutureDayOfMonth(base, Number(m[1])),
      note: "月の記載なし。受信日から候補日を計算(要確認)",
    });
    return { confirmed, candidates };
  }

  // 今日・明日・明後日
  if (/明後日/.test(text)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    confirmed.push({ date: toDateString(d) });
    return { confirmed, candidates };
  }
  if (/明日/.test(text)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    confirmed.push({ date: toDateString(d) });
    return { confirmed, candidates };
  }

  // 曜日のみ → 次のその曜日を候補として提示(確定しない)
  m = text.match(/([月火水木金土日])曜/);
  if (m) {
    const d = nextWeekday(base, m[1]);
    if (d) candidates.push({ date: d, note: `曜日のみの指定。次の${m[1]}曜日を候補として提示(要確認)` });
    return { confirmed, candidates };
  }

  // 「来週」「来月」等は日付を確定できない → 情報不足
  return { confirmed, candidates };
}

function pushRange(
  out: DateHit[],
  base: Date,
  fromMonth: number,
  fromDay: number,
  toMonth: number,
  toDay: number,
  note: string
) {
  const start = new Date(nearestFutureDate(base, fromMonth, fromDay));
  const end = new Date(nearestFutureDate(base, toMonth, toDay));
  for (let d = new Date(start); d <= end && out.length < 31; d.setDate(d.getDate() + 1)) {
    out.push({ date: toDateString(d), note });
  }
}

function extractTimes(text: string): { start: string | null; end: string | null; note?: string } {
  // 「H時からH時」
  let m = text.match(/(\d{1,2})時(?:(\d{1,2})分|半)?から(\d{1,2})時(?:(\d{1,2})分|半)?/);
  if (m) {
    return { start: fmtTime(m[1], m[2], m[0].includes("半") && !m[2]), end: fmtTime(m[3], m[4], /半$/.test(m[0])) };
  }
  m = text.match(/(\d{1,2})時半/);
  if (m) return { start: fmtTime(m[1], undefined, true), end: null };
  m = text.match(/(\d{1,2})時(\d{1,2})分/);
  if (m) return { start: fmtTime(m[1], m[2], false), end: null };
  m = text.match(/(\d{1,2})時/);
  if (m) {
    let hour = Number(m[1]);
    if (hour <= 12 && new RegExp(`午後[^。]{0,6}${m[1]}時`).test(text)) hour += 12;
    return { start: `${String(hour).padStart(2, "0")}:00`, end: null };
  }
  if (/朝一|朝いち/.test(text)) {
    return { start: null, end: null, note: "「朝一」のため時刻未確定。開始時刻の確認が必要です。" };
  }
  if (/午後/.test(text)) {
    return { start: null, end: null, note: "「午後」のみのため時刻未確定。開始時刻の確認が必要です。" };
  }
  if (/午前中/.test(text)) {
    return { start: null, end: null, note: "「午前中」のみのため時刻未確定。開始時刻の確認が必要です。" };
  }
  return { start: null, end: null };
}

function fmtTime(h: string, min: string | undefined, half: boolean): string {
  const mm = half ? "30" : String(Number(min || 0)).padStart(2, "0");
  return `${String(Number(h)).padStart(2, "0")}:${mm}`;
}

function extractWorkers(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*[人名]/);
  return m ? Number(m[1]) : null;
}

function extractSiteName(text: string): string | null {
  let m = text.match(/([^\s、。にでのをへ]{1,20}(?:工場|現場|ビル|プラント|倉庫|マンション|アパート|工事))/);
  if (m) return m[1];
  m = text.match(/([^\s、。]{1,12})の現場/);
  if (m) return `${m[1]}の現場`;
  return null;
}

function extractClientName(text: string): string | null {
  const m = text.match(/([^\s、。にでの]{1,15}(?:建設|工務店|組|ハウス|ホーム|工業(?!。)))(?:さん|様)?/);
  return m ? m[1] : null;
}

function extractAddress(text: string): string | null {
  const m = text.match(/([^\s、。にでの]{1,10}[市区町村])(?![長場])/);
  return m ? m[1] : null;
}
