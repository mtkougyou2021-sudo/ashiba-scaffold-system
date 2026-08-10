/**
 * LINEのFlexメッセージ(承認カード)がLINEの制約に適合するか検査する。
 * 実際に送るまで気づけない不備を、送信前に見つけるためのテスト。
 *   npm run test:line
 */
import { ScheduleCandidate } from "@prisma/client";
import { buildApprovalMessage, buildRejectReasonMessage } from "../src/services/line/approvalCard";
import { ExtractedCandidate, emptyCandidate } from "../src/services/ai";

type Json = Record<string, any>;

const problems: string[] = [];

function check(cond: boolean, message: string) {
  if (!cond) problems.push(message);
}

/** LINEのFlex仕様のうち、実際に400エラーになった/なりやすい制約を検査する */
function walk(node: Json, path: string, parentLayout?: string): void {
  if (!node || typeof node !== "object") return;

  if (node.type === "text") {
    // baselineレイアウトの中では wrap が使えない(LINEが400を返す)
    if (parentLayout === "baseline" && node.wrap === true) {
      problems.push(`${path}: baselineレイアウト内のtextでwrapは使用できません`);
    }
    check(typeof node.text === "string" && node.text.length > 0, `${path}: textが空です`);
  }

  if (node.type === "button") {
    const a = node.action as Json | undefined;
    check(!!a, `${path}: buttonにactionがありません`);
    if (a) {
      check(
        typeof a.label === "string" && a.label.length > 0 && a.label.length <= 20,
        `${path}: ボタンのラベルは1〜20文字にしてください(現在: ${a.label?.length}文字)`
      );
      if (a.type === "uri") {
        check(
          typeof a.uri === "string" && /^https:\/\/.+/.test(a.uri),
          `${path}: uriアクションはhttpsのURLが必要です(現在: "${a.uri}")`
        );
        // 環境変数に改行が混入するとURLが壊れ、LINEがカードごと拒否する
        check(
          typeof a.uri === "string" && !/[\s\u0000-\u001F\u007F]/.test(a.uri),
          `${path}: uriに空白・改行が含まれています(現在: ${JSON.stringify(a.uri)})`
        );
      }
      if (a.type === "postback") {
        check(
          typeof a.data === "string" && a.data.length > 0 && a.data.length <= 300,
          `${path}: postbackのdataは1〜300文字にしてください`
        );
      }
    }
  }

  if (node.type === "box") {
    check(
      ["vertical", "horizontal", "baseline"].includes(node.layout),
      `${path}: boxのlayoutが不正です(${node.layout})`
    );
    check(Array.isArray(node.contents), `${path}: boxにcontentsがありません`);
  }

  if (node.type === "bubble") {
    const sizes = ["nano", "micro", "deca", "hecto", "kilo", "mega", "giga"];
    if (node.size !== undefined) {
      check(sizes.includes(node.size), `${path}: bubbleのsizeが不正です(${node.size})`);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}.${key}[${i}]`, node.layout));
    } else if (value && typeof value === "object") {
      walk(value as Json, `${path}.${key}`, node.layout);
    }
  }
}

function validateMessage(msg: Json, label: string): void {
  if (msg.type === "flex") {
    check(
      typeof msg.altText === "string" && msg.altText.length > 0 && msg.altText.length <= 400,
      `${label}: altTextは1〜400文字にしてください`
    );
    const size = JSON.stringify(msg.contents).length;
    check(size <= 10000, `${label}: Flexの内容が10KBを超えています(${size}バイト)`);
  }
  walk(msg, label);
}

function makeCandidate(id: number, data: Partial<ExtractedCandidate>, status: string): ScheduleCandidate {
  const base = emptyCandidate("テスト用の元文章");
  const merged = { ...base, ...data };
  return {
    id,
    messageId: null,
    attachmentId: null,
    sourceText: merged.source_text,
    extractedData: merged as any,
    modifiedData: null,
    aiClassification: merged.classification,
    confidence: merged.confidence,
    missingFields: merged.missing_fields as any,
    isTentative: merged.is_tentative,
    changeType: merged.change_type,
    status,
    approvedById: null,
    approvedAt: null,
    rejectReason: null,
    googleEventId: null,
    relatedEventId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

process.env.APP_BASE_URL = process.env.APP_BASE_URL || "https://example.up.railway.app";

const cases: Array<[string, ScheduleCandidate[]]> = [
  [
    "承認可能な1件",
    [
      makeCandidate(
        1,
        {
          event_type: "現調",
          title: "港区〇〇工場",
          date: "2026-08-10",
          start_time: "09:00",
          address: "名古屋市港区",
          workers: 4,
          client_name: "〇〇建設",
          confidence: 0.9,
        },
        "pending"
      ),
    ],
  ],
  [
    "日付未確定(承認ボタンを出さない)",
    [
      makeCandidate(
        2,
        {
          event_type: "現調",
          title: "飛島の現場",
          date: null,
          date_candidates: ["2026-08-11"],
          missing_fields: ["日付(候補あり・要確認)", "開始時刻"],
          confidence: 0.5,
        },
        "insufficient"
      ),
    ],
  ],
  [
    "複数件(カルーセル)",
    [1, 2, 3].map((i) =>
      makeCandidate(
        10 + i,
        {
          event_type: "プラント定修",
          title: "非常に長い現場名を想定した確認用の名称。折り返し表示が必要になる長さ。",
          date: `2026-08-1${i}`,
          start_time: "08:00",
          workers: 6,
          confidence: 0.8,
        },
        "pending"
      )
    ),
  ],
];

console.log("=== LINE承認カードの形式チェック ===\n");
for (const [label, candidates] of cases) {
  const before = problems.length;
  validateMessage(buildApprovalMessage(candidates, "テスト送信者") as Json, label);
  console.log(`${problems.length === before ? "✅" : "❌"} ${label}`);
}

const before = problems.length;
validateMessage(buildRejectReasonMessage(1) as Json, "却下理由の選択");
console.log(`${problems.length === before ? "✅" : "❌"} 却下理由の選択`);

if (problems.length > 0) {
  console.log("\n--- 検出された問題 ---");
  problems.forEach((p) => console.log(`  ${p}`));
  console.log(`\n${problems.length}件の問題があります`);
  process.exit(1);
}
console.log("\nすべて適合しています");
