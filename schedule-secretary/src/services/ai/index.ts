import { config } from "../../config";
import { Extractor } from "./types";
import { MockExtractor } from "./mockExtractor";
import { OpenAIExtractor } from "./openaiExtractor";

let extractor: Extractor | null = null;

export function getExtractor(): Extractor {
  if (!extractor) {
    if (config.aiProvider === "openai" && config.openaiApiKey) {
      extractor = new OpenAIExtractor();
    } else {
      if (config.aiProvider === "openai") {
        console.warn("[ai] OPENAI_API_KEY 未設定のため開発用ルールベース解析器(mock)を使用します");
      }
      extractor = new MockExtractor();
    }
  }
  return extractor;
}

export * from "./types";
