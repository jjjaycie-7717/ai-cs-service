const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const BASE_DIR = path.resolve(__dirname, "..");
const EVAL_FILE = path.resolve(
  BASE_DIR,
  process.env.EVAL_FILE || "eval_queries.jsonl",
);
const RETRIEVE_BASE_URL = (
  process.env.RETRIEVE_BASE_URL || "http://127.0.0.1:3001"
).replace(/\/$/, "");
const TOP_K = Math.max(1, Math.min(20, Number(process.env.EVAL_TOP_K || 5)));

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${err.message}`);
      }
    });
}

async function runSingle(query, topK) {
  const resp = await fetch(`${RETRIEVE_BASE_URL}/api/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, topK }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`retrieve_failed ${resp.status} ${resp.statusText} ${body}`);
  }
  return resp.json();
}

async function main() {
  const raw = await fs.readFile(EVAL_FILE, "utf8");
  const rows = parseJsonl(raw);
  if (!rows.length) {
    throw new Error(`No eval data in ${EVAL_FILE}`);
  }

  let total = 0;
  let top1Hit = 0;
  let top3Hit = 0;
  let mrr = 0;
  const failures = [];

  for (const row of rows) {
    total += 1;
    const query = String(row.query || "").trim();
    const expected = String(row.expected_faq_id || "").trim();
    if (!query || !expected) {
      failures.push({
        query,
        expected,
        reason: "missing query or expected_faq_id",
      });
      continue;
    }

    try {
      const result = await runSingle(query, TOP_K);
      const hits = Array.isArray(result.hits) ? result.hits : [];

      const rank = hits.findIndex((item) => item.faq_id === expected);
      if (rank === 0) top1Hit += 1;
      if (rank >= 0 && rank < 3) top3Hit += 1;
      if (rank >= 0) {
        mrr += 1 / (rank + 1);
      } else {
        failures.push({
          query,
          expected,
          reason: "not found in topK",
          top: hits.slice(0, 3).map((item) => ({
            faq_id: item.faq_id,
            score: item.score,
            question: item.question,
          })),
        });
      }
    } catch (err) {
      failures.push({
        query,
        expected,
        reason: err.message || String(err),
      });
    }
  }

  const top1 = total ? top1Hit / total : 0;
  const top3 = total ? top3Hit / total : 0;
  const mrrAvg = total ? mrr / total : 0;

  console.log(`eval_file: ${EVAL_FILE}`);
  console.log(`total: ${total}`);
  console.log(`top1: ${top1.toFixed(4)} (${top1Hit}/${total})`);
  console.log(`top3: ${top3.toFixed(4)} (${top3Hit}/${total})`);
  console.log(`mrr:  ${mrrAvg.toFixed(4)}`);

  if (failures.length) {
    console.log("\nfailures (up to 10):");
    failures.slice(0, 10).forEach((item, idx) => {
      console.log(`\n${idx + 1}. query=${item.query}`);
      console.log(`   expected=${item.expected}`);
      console.log(`   reason=${item.reason}`);
      if (item.top) {
        item.top.forEach((topItem) => {
          console.log(
            `   top faq_id=${topItem.faq_id} score=${topItem.score} q=${topItem.question}`,
          );
        });
      }
    });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
