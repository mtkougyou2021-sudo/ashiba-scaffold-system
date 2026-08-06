/**
 * 必須テスト: 仕様書に定められた8つの文章でAI解析を検証する。
 * DB不要。現在の AI_PROVIDER 設定(未設定ならルールベース)で実行される。
 *   npm run test:ai
 */
import { getExtractor, ExtractionResult } from "../src/services/ai";

interface TestCase {
  no: number;
  text: string;
  expectation: string;
  check: (r: ExtractionResult) => { pass: boolean; detail: string };
}

const receivedAt = new Date(); // 受信日時=現在として相対日付を計算

const CASES: TestCase[] = [
  {
    no: 1,
    text: "8月10日9時に港区〇〇工場で現調お願いします",
    expectation: "承認待ち(日付・時刻・場所が確定)",
    check: (r) => {
      const c = r.candidates[0];
      return {
        pass:
          r.candidates.length === 1 &&
          c.classification === "approval_pending" &&
          c.date !== null &&
          c.date.endsWith("-08-10") &&
          c.start_time === "09:00" &&
          c.event_type === "現調",
        detail: `classification=${c?.classification} date=${c?.date} start=${c?.start_time} type=${c?.event_type}`,
      };
    },
  },
  {
    no: 2,
    text: "来週どこかで一度現場を見てください",
    expectation: "情報不足(日付を勝手に決めない)",
    check: (r) => {
      const c = r.candidates[0];
      return {
        pass:
          c.classification === "insufficient" &&
          c.date === null &&
          c.missing_fields.some((f) => f.includes("日付")),
        detail: `classification=${c?.classification} date=${c?.date} missing=[${c?.missing_fields.join(",")}]`,
      };
    },
  },
  {
    no: 3,
    text: "火曜日の朝一、飛島の現場で足場組立4人お願いします",
    expectation: "日付候補あり・時刻未確定・確認必要(確定しない)",
    check: (r) => {
      const c = r.candidates[0];
      return {
        pass:
          c.classification === "insufficient" &&
          c.date === null &&
          c.date_candidates.length > 0 &&
          c.start_time === null &&
          c.workers === 4 &&
          c.event_type === "足場組立",
        detail: `classification=${c?.classification} date=${c?.date} candidates=[${c?.date_candidates.join(",")}] start=${c?.start_time} workers=${c?.workers}`,
      };
    },
  },
  {
    no: 4,
    text: "前に言っていた現調、11日の午後に変更でお願いします",
    expectation: "変更候補(新規予定を作らない)",
    check: (r) => {
      const c = r.candidates[0];
      return {
        pass: c.classification === "change_candidate" && c.change_type === "change",
        detail: `classification=${c?.classification} change_type=${c?.change_type}`,
      };
    },
  },
  {
    no: 5,
    text: "10日の足場組立は中止になりました",
    expectation: "中止候補(自動削除しない)",
    check: (r) => {
      const c = r.candidates[0];
      return {
        pass: c.classification === "cancel_candidate" && c.change_type === "cancel",
        detail: `classification=${c?.classification} change_type=${c?.change_type}`,
      };
    },
  },
  {
    no: 6,
    text: "お疲れ様です。今日もよろしくお願いします",
    expectation: "対象外(挨拶)",
    check: (r) => {
      const c = r.candidates[0];
      return { pass: c.classification === "out_of_scope", detail: `classification=${c?.classification}` };
    },
  },
  {
    no: 7,
    text: "15日から17日まで〇〇工場の定修、毎日6人お願いします",
    expectation: "複数日予定候補(3件に分割)",
    check: (r) => {
      const days = r.candidates.map((c) => c.date ?? c.date_candidates[0] ?? "null");
      return {
        pass:
          r.candidates.length === 3 &&
          r.candidates.every((c) => c.workers === 6) &&
          r.candidates.every((c) => c.classification !== "out_of_scope"),
        detail: `count=${r.candidates.length} days=[${days.join(",")}] workers=${r.candidates[0]?.workers}`,
      };
    },
  },
  {
    no: 8,
    text: "来月の工程表送ります",
    expectation: "添付ファイルが無ければ予定登録しない(対象外)",
    check: (r) => {
      const c = r.candidates[0];
      return { pass: c.classification === "out_of_scope", detail: `classification=${c?.classification}` };
    },
  },
];

async function main() {
  const extractor = getExtractor();
  let passCount = 0;

  console.log("=== AI解析 必須テスト(8件) ===\n");
  for (const t of CASES) {
    try {
      const result = await extractor.extract({ text: t.text, receivedAt });
      const { pass, detail } = t.check(result);
      if (pass) passCount++;
      console.log(`テスト${t.no}: ${pass ? "✅ 合格" : "❌ 不合格"}`);
      console.log(`  文章: ${t.text}`);
      console.log(`  期待: ${t.expectation}`);
      console.log(`  結果: ${detail}\n`);
    } catch (err) {
      console.log(`テスト${t.no}: ❌ エラー: ${err instanceof Error ? err.message : err}\n`);
    }
  }
  console.log(`=== 合計: ${passCount} / ${CASES.length} 合格 ===`);
  process.exit(passCount === CASES.length ? 0 : 1);
}

main();
