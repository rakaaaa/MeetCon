import { AiProviderSchema, GenerateQuestionSchema } from "@meetcon/shared";
import { z } from "zod";
import { config } from "../../config.js";
import { AppError } from "../../lib.js";
import { assistantAccessToken, type AssistantProvider } from "../auth/assistants.js";

type Provider = z.infer<typeof AiProviderSchema>;

const names: Record<Provider, string> = { openai: "ChatGPT", gemini: "Gemini", anthropic: "Claude" };

const instructions = `You write poll questions for a live meetup. Reply with CSV only. Do not add a title, markdown, or explanation.
The first line must be exactly:
Question,Option A,Option B,Option C,Option D
Each following line is one question and four different short options. The options must be mutually exclusive answers to that question.
If a field contains a comma or a quotation mark, wrap that field in double quotes and double any quotation mark inside it.`;

function task(input: { topic: string; count: number; title?: string; questionnaire?: string }) {
  return [input.title ? `Meetup: ${input.title}` : "", input.questionnaire ? `Questionnaire: ${input.questionnaire}` : "", `Topic: ${input.topic}`, `Write exactly ${input.count} questions.`].filter(Boolean).join("\n");
}

function parseCsv(text: string) {
  const source = text.trim().replace(/^```(?:csv)?\s*/i, "").replace(/\s*```$/, "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char ?? "";
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += char ?? "";
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function questionsFromCsv(text: string, limit: number) {
  const grid = parseCsv(text);
  const header = (grid[0] ?? []).map((value) => value.trim().toLowerCase());
  const expected = ["question", "option a", "option b", "option c", "option d"];
  if (!expected.every((name) => header.includes(name))) return [];
  const indexes = expected.map((name) => header.indexOf(name));
  const questions: { prompt: string; options: [string, string, string, string] }[] = [];
  for (const line of grid.slice(1)) {
    const [prompt, optionA, optionB, optionC, optionD] = indexes.map((column) => (line[column] ?? "").trim());
    if (!prompt && !optionA && !optionB && !optionC && !optionD) continue;
    if (!prompt || !optionA || !optionB || !optionC || !optionD) continue;
    if (prompt.length > 1000 || [optionA, optionB, optionC, optionD].some((option) => option.length > 300)) continue;
    questions.push({ prompt, options: [optionA, optionB, optionC, optionD] });
    if (questions.length === limit) break;
  }
  return questions;
}

async function readText(response: Response) {
  if (!response.ok || !response.body) return response.status;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data) as { type?: string; delta?: string; response?: { output?: { content?: { text?: string }[] }[] } };
        if (payload.type === "response.output_text.delta" && payload.delta) text += payload.delta;
        if (payload.type === "response.failed") return 502;
        if (payload.type === "response.completed") {
          const completed = payload.response?.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("") ?? "";
          if (completed) text = completed;
        }
      } catch { /* ignore keep-alive chunks */ }
    }
  }
  return text;
}

async function complete(provider: Provider, accessToken: string, input: { topic: string; count: number; title?: string; questionnaire?: string }) {
  const prompt = task(input);
  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.OPENAI_MODEL || "gpt-4o-mini", store: false, stream: true, max_output_tokens: 4000, instructions, input: prompt }),
    });
    return readText(response);
  }
  if (provider === "gemini") {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
      }),
    });
    if (!response.ok) return response.status;
    const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 4000, temperature: 0.7, system: instructions, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) return response.status;
  const payload = await response.json() as { content?: { type?: string; text?: string }[] };
  return payload.content?.find((block) => block.type === "text")?.text ?? "";
}

export async function generateMeetupQuestion(userId: string, body: unknown) {
  const input = GenerateQuestionSchema.parse(body);
  const provider = input.provider as AssistantProvider;
  const accessToken = await assistantAccessToken(userId, provider);
  if (!accessToken) throw new AppError(503, "AI_NOT_CONFIGURED", `Connect ${names[provider]} in Settings before drafting questions.`);
  let content: string | number;
  try {
    content = await complete(provider, accessToken, {
      topic: input.topic,
      count: input.count,
      ...(input.title ? { title: input.title } : {}),
      ...(input.questionnaire ? { questionnaire: input.questionnaire } : {}),
    });
  } catch {
    throw new AppError(502, "AI_FAILED", `${names[provider]} could not be reached.`);
  }
  if (typeof content === "number") {
    if (content === 401 || content === 403) throw new AppError(502, "AI_UNAUTHORIZED", `${names[provider]} rejected this connection. Reconnect it in Settings.`);
    if (content === 429) throw new AppError(429, "AI_BUSY", `${names[provider]} is busy. Try again in a moment.`);
    throw new AppError(502, "AI_FAILED", `${names[provider]} could not generate questions.`);
  }
  const questions = questionsFromCsv(content, input.count);
  if (!questions.length) throw new AppError(502, "AI_INVALID", `${names[provider]} did not return questions in the Excel CSV format.`);
  const csv = ["Question,Option A,Option B,Option C,Option D", ...questions.map((question) => [question.prompt, ...question.options].map(csvCell).join(","))].join("\n");
  return { csv, count: questions.length, requested: input.count };
}
