import { ScheduleCandidate } from "@prisma/client";
import { config } from "../../config";
import { effectiveData, STATUS_LABELS, buildEventTitle } from "../candidateService";
import { formatDateJa } from "../../utils/dates";
import { LineMessage } from "./lineClient";

const GREEN = "#1A6B54";
const ORANGE = "#B7791F";
const GRAY = "#6B7A74";

/**
 * LINEはFlexの指定が1つでも不正だとカード全体を拒否し、承認ボタンが表示できなくなる。
 * 装飾よりも「確実に表示されること」を優先し、縦並びのboxとtext・buttonだけで組む。
 */

function line(text: string, color?: string, bold = false): LineMessage {
  const node: LineMessage = { type: "text", text, size: "sm", wrap: true };
  if (color) node.color = color;
  if (bold) node.weight = "bold";
  return node;
}

/**
 * LINEは不正なURLを含むカードを丸ごと拒否し、承認ボタンごと表示できなくなる。
 * 環境変数に改行や空白が混入していた場合でも巻き添えにならないよう、
 * URLとして成立することを確認し、駄目ならボタンを出さない。
 */
function candidateLink(id: number): string {
  const base = config.appBaseUrl;
  if (!base.startsWith("https://")) return "";
  const url = `${base}/candidates/${id}`;
  // 空白・改行・制御文字が含まれるURLはLINEが受け付けない
  if (/[\s\u0000-\u001F\u007F]/.test(url)) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

/** ボタンのラベルは20文字までのため、超えないことを保証する */
function label(text: string): string {
  return text.length <= 20 ? text : `${text.slice(0, 19)}…`;
}

export function buildApprovalBubble(candidate: ScheduleCandidate, senderName: string): LineMessage {
  const d = effectiveData(candidate);
  const canApproveHere = !!d.date;

  const dateText = d.date
    ? formatDateJa(d.date)
    : d.date_candidates.length > 0
      ? `候補 ${d.date_candidates.map(formatDateJa).join(" / ")}`
      : "未確定";
  const timeText = d.start_time ? `${d.start_time}${d.end_time ? `〜${d.end_time}` : ""}` : "未確定";

  const body: LineMessage[] = [
    line(buildEventTitle(d), undefined, true),
    line(`状態: ${STATUS_LABELS[candidate.status] ?? candidate.status}`, ORANGE),
    line(`日付: ${dateText}`, d.date ? undefined : ORANGE),
    line(`時刻: ${timeText}`, d.start_time ? undefined : ORANGE),
  ];
  if (d.address) body.push(line(`場所: ${d.address}`));
  if (d.workers !== null && d.workers !== undefined) body.push(line(`人数: ${d.workers}名`));
  if (d.client_name) body.push(line(`元請: ${d.client_name}`));
  if (Array.isArray(d.missing_fields) && d.missing_fields.length > 0) {
    body.push(line(`不足: ${d.missing_fields.join("、")}`, ORANGE));
  }
  body.push(line(`送信元: ${senderName}`, GRAY));

  const footer: LineMessage[] = [];
  if (canApproveHere) {
    footer.push({
      type: "button",
      style: "primary",
      color: GREEN,
      action: {
        type: "postback",
        label: label("承認してカレンダー登録"),
        data: `action=approve&id=${candidate.id}`,
        displayText: "承認します",
      },
    });
    footer.push({
      type: "button",
      style: "secondary",
      action: {
        type: "postback",
        label: label("却下"),
        data: `action=reject&id=${candidate.id}`,
        displayText: "却下します",
      },
    });
  } else {
    footer.push(line("日付が未確定のため、詳細画面で補完してから承認してください。", ORANGE));
  }

  const url = candidateLink(candidate.id);
  if (url) {
    footer.push({
      type: "button",
      style: "link",
      action: { type: "uri", label: label(canApproveHere ? "詳細・修正" : "詳細画面を開く"), uri: url },
    });
  }

  return {
    type: "bubble",
    body: { type: "box", layout: "vertical", spacing: "sm", contents: body },
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: footer },
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
          label: label(reason),
          data: `action=reject_reason&id=${candidateId}&reason=${encodeURIComponent(reason)}`,
          displayText: reason,
        },
      })),
    },
  };
}
