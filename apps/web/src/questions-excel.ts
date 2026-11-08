const HEADERS = ["Question", "Option A", "Option B", "Option C", "Option D"] as const;
const MAX_QUESTIONS = 20;

export type ImportedQuestion = { prompt: string; options: [string, string, string, string] };

function cell(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fileSlug(title: string) {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug || "questionnaire";
}

export async function downloadQuestionWorkbook(title: string, questions: { prompt: string; options: { label: string }[] }[], kind: "format" | "questions" = "questions") {
  const XLSX = await import("xlsx");
  const filled = questions.filter((question) => question.prompt.trim() || question.options.some((option) => option.label.trim()));
  const source = kind === "questions" ? filled : [{ prompt: "", options: [{ label: "" }, { label: "" }, { label: "" }, { label: "" }] }];
  const rows = [
    [...HEADERS],
    ...source.map((question) => [
      question.prompt,
      question.options[0]?.label ?? "",
      question.options[1]?.label ?? "",
      question.options[2]?.label ?? "",
      question.options[3]?.label ?? "",
    ]),
  ];
  const questionsSheet = XLSX.utils.aoa_to_sheet(rows);
  questionsSheet["!cols"] = [{ wch: 64 }, { wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 28 }];
  const instructions = XLSX.utils.aoa_to_sheet([
    ["MeetPlus question import"],
    [`Questionnaire: ${title.trim() || "Questionnaire"}`],
    ["Use the Questions sheet. One row is one question."],
    ["Every question needs the prompt and all four options."],
    ["Leave unused rows blank. A questionnaire can import at most 20 questions."],
    ["Upload this file on that questionnaire. It replaces the questions shown there."],
    ["Save the meetup after uploading."],
  ]);
  instructions["!cols"] = [{ wch: 88 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, questionsSheet, "Questions");
  XLSX.utils.book_append_sheet(book, instructions, "Instructions");
  XLSX.writeFile(book, `meetplus-${fileSlug(title)}-${kind === "format" ? "format" : "questions"}.xlsx`);
}

function questionsFromGrid(grid: unknown[][]) {
  const expected = HEADERS.map((header) => header.toLowerCase());
  const headerIndex = grid.findIndex((row) => {
    const names = (row ?? []).map((value) => cell(value).toLowerCase());
    return expected.every((name) => names.includes(name));
  });
  if (headerIndex < 0) throw new Error("Use the downloaded Excel format. Columns must be Question, Option A, Option B, Option C, and Option D.");
  const header = (grid[headerIndex] ?? []).map((value) => cell(value).toLowerCase());
  const indexes = expected.map((name) => header.indexOf(name));
  const questions: ImportedQuestion[] = [];
  const problems: string[] = [];
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const values = indexes.map((column) => cell(row[column]));
    if (values.every((value) => !value)) continue;
    const [prompt, optionA, optionB, optionC, optionD] = values;
    const excelRow = index + 1;
    if (!prompt || !optionA || !optionB || !optionC || !optionD) {
      problems.push(`Row ${excelRow} needs a question and all four options.`);
      continue;
    }
    if (prompt.length > 1000 || [optionA, optionB, optionC, optionD].some((option) => option.length > 300)) {
      problems.push(`Row ${excelRow} is too long. Questions can be 1000 characters and each option 300.`);
      continue;
    }
    questions.push({ prompt, options: [optionA, optionB, optionC, optionD] });
  }
  if (questions.length > MAX_QUESTIONS) throw new Error("A questionnaire can import at most 20 questions.");
  if (problems.length) throw new Error(problems.slice(0, 3).join(" "));
  if (!questions.length) throw new Error("Add at least one question under the header row.");
  return questions;
}

export function questionsFromCsv(text: string) {
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
  return questionsFromGrid(rows);
}

export async function questionsFromWorkbook(data: ArrayBuffer): Promise<ImportedQuestion[]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "array" });
  const sheetName = book.SheetNames.find((name) => name.toLowerCase() === "questions") ?? book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("The workbook has no Questions sheet.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return questionsFromGrid(grid);
}
