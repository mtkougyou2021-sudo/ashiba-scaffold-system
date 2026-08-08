import { ScheduleCandidate } from "@prisma/client";
import { config } from "../../config";
import { effectiveData, STATUS_LABELS, buildEventTitle } from "../candidateService";
import { formatDateJa } from "../../utils/dates";
import { LineMessage } from "./lineClient";

const GREEN = "#1A6B54";
const ORANGE = "#B7791F";
const RED = "#C0392B";
const GRAY = "#6B7A74";

/**
 * 項目行。
 * baselineレイアウトは文字の折り返し(wrap)を受け付けずLINE側で拒否されるため、
 * horizontalを使う。現場名や住所は長くなるので折り返しは必須。
 */
function row(label: string, value: string, color = "#1F2A26"): LineMessage {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: GRAY, size: "sm", flex: 2, wrap: false },
      { type: "text", text: value, wrap: true, color, size: "sm", flex: 5 },
    ],
  };
}

/**
 * LINEはhttps以外のURLを含むカードを丸ごと拒否する。
 * リンクが使えない場合はボタン自体を出さず、カードは表示できるようにする。
 */
function candidateLink(id: number): string {
  if (!config.appBaseUrl.startsWith("https://")) return "";
  return `${config.appBaseUrl}/candidates/${id}`;
}

/**
 * 承認カード(1件)。
 * LINEのトーク画面だけで承認・却下できるようにする。
 * 日付が未確定の候補は誤登録を防ぐため、承認ボタンを出さず管理画面へ誘導する。
 */
export function buildApprovalBubble(candidate: ScheduleCandidate, senderName: string): LineMessage {
  const d = effectiveData(candidate);
  const canApproveHere = !!d.date;

  const dateLabel = d.date
    ? formatDateJa(d.date)
    : d.date_candidates.length > 0
      ? `候補 ${d.date_candidates.map(formatDateJa).join(" / ")}`
      : "未確定";
  const timeLabel = d.start_time ? `${d.start_time}${d.end_time ? `〜${d.end_time}` : ""}` : "未確定";

  const statusColor =
    candidate.status === "pending" ? ORANGE : candidate.status === "insufficient" ? RED : GRAY;

  const body: LineMessage[] = [
    row("状態", STATUS_LABELS[candidate.status] ?? candidate.status, statusColor),
    row("日付", dateLabel, d.date ? "#1F2A26" : ORANGE),
    row("時刻", timeLabel, d.start_time ? "#1F2A26" : ORANGE),
  ];
  if (d.address) body.push(row("場所", d.address));
  if (d.workers !== null) body.push(row("人数", `${d.workers}名`));
  if (d.client_name) body.push(row("元請", d.client_name));
  if (d.missing_fields.length > 0) body.push(row("不足", d.missing_fields.join("、"), ORANGE));
  body.push(row("送信元", senderName));

  const footer: LineMessage[] = [];
  if (canApproveHere) {
    footer.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: GREEN,
      action: {
        type: "postback",
        label: "承認してカレンダー登録",
        data: `action=approve&id=${candidate.id}`,
        displayText: "承認します",
      },
    });
    footer.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: {
        type: "postback",
        label: "却下",
        data: `action=reject&id=${candidate.id}`,
        displayText: "却下します",
      },
    });
  } else {
    footer.push({
      type: "text",
      text: "日付が未確定のため、この画面からは登録できません。詳細画面で補完してください。",
      size: "xs",
      color: ORANGE,
      wrap: true,
    });
  }

  const link = candidateLink(candidate.id);
  if (link) {
    footer.push({
      type: "button",
      style: "link",
      height: "sm",
      action: { type: "uri", label: canApproveHere ? "詳細・修正" : "詳細画面を開く", uri: link },
    });
  }

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: GREEN,
      paddingAll: "12px",
      contents: [
        {
          type: "text",
          text: buildEventTitle(d),
          color: "#FFFFFF",
          weight: "bold",
          size: "md",
          wrap: true,
        },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: body },
    footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footer },
  };
}

/** 複数候補をまとめて1通で送る(LINEのカルーセルは最大12件) */
export function buildApprovalMessage(candidates: ScheduleCandidate[], senderName: string): LineMessage {
  const bubbles = candidates.slice(0, 10).map((c) => buildApprovalBubble(c, senderName));
  if (bubbles.length === 1) {
    return { type: "flex", altText: `予定候補の承認依頼(${senderName})`, contents: bubbles[0] };
  }
  return {
    type: "flex",
    altText: `予定候補の承認依頼 ${candidates.length}件(${senderName})`,
    contents: { type: "carousel", contents: bubbles },
  };
}

/** 却下理由の選択(クイックリプライ) */
export const REJECT_REASONS = ["単なる連絡", "まだ未確定", "日程が違う", "重複", "不要", "その他"];

export function buildRejectReasonMessage(candidateId: number): LineMessage {
  return {
    type: "text",
    text: "却下の理由を選んでください(履歴として残ります)",
    quickReply: {
      items: REJECT_REASONS.map((reason) => ({
        type: "action",
        action: {
          type: "postback",
          label: reason,
          data: `action=reject_reason&id=${candidateId}&reason=${encodeURIComponent(reason)}`,
          displayText: reason,
        },
      })),
    },
  };
}
