const fs = require("fs/promises");
const path = require("path");

const BASE_DIR = path.resolve(__dirname, "..");
const DEFAULT_EXCEL_FILE = "/Users/jaycie/Desktop/FAQ 知识_F860.xlsx";
const FAQ_SOURCE_FILE = path.resolve(BASE_DIR, "data", "faq_source.json");
const CHUNKS_FILE = path.resolve(BASE_DIR, "faq_chunks.jsonl");
const EVAL_FILE = path.resolve(BASE_DIR, "eval_queries.jsonl");

function normalizeCell(value) {
  return String(value || "").trim();
}

function unique(items) {
  return [...new Set(items)];
}

function padId(index) {
  return String(index).padStart(3, "0");
}

function splitSimilarQuestions(value) {
  return unique(
    normalizeCell(value)
      .split("|")
      .map((item) => normalizeCell(item))
      .filter(Boolean),
  );
}

function normalizeFaqRows(rows) {
  return rows.map((row, index) => {
    const question = normalizeCell(row.question);
    const answer = String(row.answer || "").trim();
    const category = normalizeCell(row.category);
    const similarQuestions = splitSimilarQuestions(row.similarQuestions).filter(
      (item) => item !== question,
    );

    return {
      faq_id: `F860-${padId(index + 1)}`,
      category,
      question,
      answer,
      similar_questions: similarQuestions,
    };
  });
}

function buildFaqChunks(faqs) {
  return faqs.map((faq, index) => {
    const chunkTextParts = [
      `分类：${faq.category}`,
      `标准问题：${faq.question}`,
      `相似问题：${faq.similar_questions.join(" | ") || "无"}`,
      `答案：${faq.answer}`,
    ];

    return {
      chunk_id: `chunk_${padId(index + 1)}`,
      faq_id: faq.faq_id,
      question: faq.question,
      answer: faq.answer,
      chunk_text: chunkTextParts.join("\n"),
    };
  });
}

function buildEvalQueries(faqs) {
  return faqs.flatMap((faq) =>
    [faq.question, ...faq.similar_questions].map((query) => ({
      query,
      expected_faq_id: faq.faq_id,
    })),
  );
}

function readExcelRows(filePath) {
  const xlsx = require("xlsx");
  const workbook = xlsx.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Excel 中没有可读取的 sheet");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  return rows
    .map((row) => ({
      question: normalizeCell(row["标准问题（必填）"]),
      similarQuestions: normalizeCell(row["相似问题（非必填）"]),
      category: normalizeCell(row["分类（必填）"]),
      answer: String(row["答案（必填）"] || "").trim(),
    }))
    .filter((row) => row.question && row.category && row.answer);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

async function rebuildFaqData(excelFile) {
  const rows = readExcelRows(excelFile);
  const faqs = normalizeFaqRows(rows);
  const chunks = buildFaqChunks(faqs);
  const evalQueries = buildEvalQueries(faqs);

  await writeJson(FAQ_SOURCE_FILE, faqs);
  await writeJsonl(CHUNKS_FILE, chunks);
  await writeJsonl(EVAL_FILE, evalQueries);

  return {
    faqCount: faqs.length,
    chunkCount: chunks.length,
    evalCount: evalQueries.length,
  };
}

async function main() {
  const excelFile = path.resolve(process.argv[2] || DEFAULT_EXCEL_FILE);
  const result = await rebuildFaqData(excelFile);

  console.log(`excel_file: ${excelFile}`);
  console.log(`faq_count: ${result.faqCount}`);
  console.log(`chunk_count: ${result.chunkCount}`);
  console.log(`eval_count: ${result.evalCount}`);
  console.log(`wrote: ${FAQ_SOURCE_FILE}`);
  console.log(`wrote: ${CHUNKS_FILE}`);
  console.log(`wrote: ${EVAL_FILE}`);
}

module.exports = {
  normalizeFaqRows,
  buildFaqChunks,
  buildEvalQueries,
  readExcelRows,
  rebuildFaqData,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
