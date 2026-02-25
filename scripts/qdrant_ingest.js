const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const BASE_DIR = path.resolve(__dirname, "..");
const INPUT_FILE = path.resolve(
  BASE_DIR,
  process.env.CHUNKS_FILE || "faq_chunks.jsonl",
);
const EMBEDDING_BASE_URL = (
  process.env.EMBEDDING_BASE_URL || "http://127.0.0.1:1234/v1"
).replace(/\/$/, "");
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-nomic-embed-text-v1.5";
const EMBEDDING_API_KEY =
  process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";

const QDRANT_URL = (process.env.QDRANT_URL || "").replace(/\/$/, "");
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "faq_chunks";
const QDRANT_RECREATE = (process.env.QDRANT_RECREATE || "true") === "true";
const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || 16);
const QUERY_TOP_K = Number(process.env.QUERY_TOP_K || 5);
const TEST_QUERY = process.env.TEST_QUERY || "怎么开启电子围栏告警？";

function parseJsonl(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return rows.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSONL at line ${idx + 1}: ${err.message}`);
    }
  });
}

function embeddingHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (EMBEDDING_API_KEY) {
    headers.Authorization = `Bearer ${EMBEDDING_API_KEY}`;
  }
  return headers;
}

function qdrantHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (QDRANT_API_KEY) {
    headers["api-key"] = QDRANT_API_KEY;
  }
  return headers;
}

async function embedBatch(inputs) {
  const response = await fetch(`${EMBEDDING_BASE_URL}/embeddings`, {
    method: "POST",
    headers: embeddingHeaders(),
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Embedding request failed: ${response.status} ${response.statusText}\n${body}`,
    );
  }

  const json = await response.json();
  if (!Array.isArray(json.data) || json.data.length !== inputs.length) {
    throw new Error("Unexpected embedding response shape");
  }
  return json.data.map((item) => item.embedding);
}

async function qdrantRequest(method, apiPath, body) {
  const response = await fetch(`${QDRANT_URL}${apiPath}`, {
    method,
    headers: qdrantHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Qdrant request failed: ${method} ${apiPath} -> ${response.status} ${response.statusText}\n${text}`,
    );
  }
  return response.json();
}

async function ensureCollection(vectorSize) {
  if (QDRANT_RECREATE) {
    try {
      await qdrantRequest("DELETE", `/collections/${QDRANT_COLLECTION}`);
    } catch (err) {
      const msg = String(err.message || err);
      if (!msg.includes("404")) {
        throw err;
      }
    }
  }

  await qdrantRequest("PUT", `/collections/${QDRANT_COLLECTION}`, {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  });
}

async function upsertPoints(points) {
  await qdrantRequest(
    "PUT",
    `/collections/${QDRANT_COLLECTION}/points?wait=true`,
    { points },
  );
}

async function testSearch() {
  const vectors = await embedBatch([`search_query: ${TEST_QUERY}`]);
  const queryVector = vectors[0];

  const result = await qdrantRequest(
    "POST",
    `/collections/${QDRANT_COLLECTION}/points/search`,
    {
      vector: queryVector,
      limit: QUERY_TOP_K,
      with_payload: true,
      with_vector: false,
    },
  );

  return Array.isArray(result.result) ? result.result : [];
}

async function main() {
  if (!QDRANT_URL) {
    throw new Error("QDRANT_URL is required");
  }

  const raw = await fs.readFile(INPUT_FILE, "utf8");
  const chunks = parseJsonl(raw);
  if (!chunks.length) {
    throw new Error(`No chunks found in ${INPUT_FILE}`);
  }

  let initialized = false;
  let vectorSize = 0;
  let uploaded = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((item) => `search_document: ${item.chunk_text || ""}`);
    const vectors = await embedBatch(inputs);

    if (!initialized) {
      vectorSize = vectors[0]?.length || 0;
      if (!vectorSize) {
        throw new Error("Embedding vector size is 0");
      }
      await ensureCollection(vectorSize);
      initialized = true;
    }

    const points = batch.map((item, idx) => ({
      id: i + idx + 1,
      vector: vectors[idx],
      payload: {
        chunk_id: item.chunk_id,
        faq_id: item.faq_id,
        question: item.question,
        answer: item.answer,
        chunk_text: item.chunk_text,
      },
    }));

    await upsertPoints(points);
    uploaded += points.length;
    process.stdout.write(`uploaded ${uploaded}/${chunks.length}\n`);
  }

  const hits = await testSearch();
  console.log(`done: uploaded=${uploaded}, dim=${vectorSize}, collection=${QDRANT_COLLECTION}`);
  console.log(`test query: ${TEST_QUERY}`);
  for (const hit of hits) {
    const payload = hit.payload || {};
    console.log(
      `score=${Number(hit.score || 0).toFixed(4)} faq_id=${payload.faq_id || "-"} question=${payload.question || "-"}`,
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
