import type { LanguageModelMiddleware } from "ai";

/** Keep the application's output contract independent of provider-side schema
 * dialects. Output.object retains this schema for final validation; the model
 * receives the same contract as instructions and only needs JSON Object mode.
 * Plain-text calls pass through unchanged. */
export const structuredOutputMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  transformParams: async ({ params }) => {
    const format = params.responseFormat;
    if (format?.type !== "json" || !format.schema) return params;
    return {
      ...params,
      responseFormat: { type: "json" },
      prompt: [{ role: "system", content:
        `结构化输出契约（${format.name || "response"}）：只返回一个JSON对象，不返回数组或Markdown。字段名称必须原样使用，不使用别名。完整输出必须符合以下JSON Schema；不确定的信息按契约填写null或请求澄清，不编造。\nJSON Schema:\n${JSON.stringify(format.schema)}` },
      ...params.prompt],
    };
  },
};
