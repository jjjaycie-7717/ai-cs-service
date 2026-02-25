const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const fs = require("fs/promises");
const path = require("path");

dotenv.config();

const app = express();
const dataDir = path.join(__dirname, "data");
const publicDir = path.join(__dirname, "public");

function envNumber(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const port = envNumber("PORT", 3001);
const chunksFilePath = path.resolve(
  __dirname,
  process.env.CHUNKS_FILE || "faq_chunks.jsonl",
);
const chatModel = process.env.CHAT_MODEL || "gpt-4o-mini";

const embeddingBaseUrl = (
  process.env.EMBEDDING_BASE_URL || "http://127.0.0.1:1234/v1"
).replace(/\/$/, "");
const embeddingModel =
  process.env.EMBEDDING_MODEL || "text-embedding-nomic-embed-text-v1.5";
const embeddingApiKey =
  process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";

const qdrantUrl = (process.env.QDRANT_URL || "").replace(/\/$/, "");
const qdrantApiKey = process.env.QDRANT_API_KEY || "";
const qdrantCollection = process.env.QDRANT_COLLECTION || "faq_chunks";
const ragTopK = envNumber("RAG_TOP_K", 5);
const denseCandidateK = envNumber("DENSE_CANDIDATE_K", 20);
const bm25CandidateK = envNumber("BM25_CANDIDATE_K", 20);
const hybridRrfK = envNumber("HYBRID_RRF_K", 60);
const rerankWeightDense = envNumber("RERANK_WEIGHT_DENSE", 0.62);
const rerankWeightBm25 = envNumber("RERANK_WEIGHT_BM25", 0.16);
const rerankWeightLexical = envNumber("RERANK_WEIGHT_LEXICAL", 0.22);
const ragScoreThreshold = envNumber("RAG_SCORE_THRESHOLD", 0.58);
const autoHandoffEnabled = (process.env.AUTO_HANDOFF_ENABLED || "true") === "true";
const autoHandoffThreshold = envNumber("AUTO_HANDOFF_THRESHOLD", 0.6);
const answerConfidenceThreshold = envNumber("ANSWER_CONFIDENCE_THRESHOLD", 0.78);
const lexicalMatchMin = envNumber("LEXICAL_MATCH_MIN", 0.15);
const directAnswerMinScore = envNumber(
  "DIRECT_ANSWER_MIN_SCORE",
  autoHandoffThreshold,
);
const decisionQuestionMinScore = envNumber("DECISION_QUESTION_MIN_SCORE", 0.68);
const decisionQuestionLexicalMin = envNumber(
  "DECISION_QUESTION_LEXICAL_MIN",
  0.45,
);
const semanticMatchMinDense = envNumber("SEMANTIC_MATCH_MIN_DENSE", 0.6);
const semanticLexicalFloor = envNumber("SEMANTIC_LEXICAL_FLOOR", 0.18);
const intentAnswerMinScore = envNumber("INTENT_ANSWER_MIN_SCORE", 0.56);
const queryVariantLimit = envNumber("QUERY_VARIANT_LIMIT", 4);
const unknownTopicScoreMax = envNumber("UNKNOWN_TOPIC_SCORE_MAX", 0.64);
const unknownTopicDenseMax = envNumber("UNKNOWN_TOPIC_DENSE_MAX", 0.74);
const unknownTopicLexicalMax = envNumber("UNKNOWN_TOPIC_LEXICAL_MAX", 0.16);
const pendingHandoffTtlMs = envNumber("PENDING_HANDOFF_TTL_MS", 10 * 60 * 1000);
const pendingHandoffConfirmations = new Map();
let bm25IndexPromise = null;

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.get("/h5/chat", (req, res) => {
  res.sendFile(path.join(publicDir, "embed.html"));
});

let openaiClient = null;
if (process.env.OPENAI_API_KEY) {
  const options = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.OPENAI_BASE_URL) {
    options.baseURL = process.env.OPENAI_BASE_URL.replace(/\/$/, "");
  }
  openaiClient = new OpenAI(options);
}

const assistantSystemPrompt = [
  "你是【Weilturn F860电子围栏】的AI客服，专注回答该产品的使用、功能、技术和售后等问题。",
  "回答必须严格基于提供的知识库内容，禁止编造。",
  "如果知识库中没有相关信息，请礼貌告知用户：“抱歉，这个问题我暂时无法回答，你可以联系人工客服获取帮助。”",
  "不可回答：硬件维修或更换、与其他品牌设备兼容性、用户隐私数据（如位置历史）。",
  "回答要通俗易懂，避免使用专业术语，保持亲切，优先分步骤说明。",
  "用户提问不需要和知识库问题逐字一致，只要语义一致就应返回对应答案。",
  "对于“是否/能否/要不要”这类明确问题，只要知识库有直接结论，必须先直接给结论，不要先追问。",
  "回答不要太简略：先给结论，再补充依据或步骤。",
].join("\n");

const termAliasGroups = [
  {
    canonical: "电子围栏",
    aliases: ["电子围栏", "GPS围栏", "GPS 围栏", "安全围栏"],
  },
  {
    canonical: "F860 项圈",
    aliases: ["F860 项圈", "项圈", "设备", "追踪器"],
  },
  {
    canonical: "订阅",
    aliases: ["订阅", "会员", "套餐", "续费", "付费服务"],
  },
];

const queryIntentProfiles = [
  {
    name: "subscription_fee",
    patterns: [/(订阅|会员|套餐|续费|收费|付费|月费|年费)/],
    queryHints: ["F860 需要订阅费吗？", "F860 是什么产品？"],
    priorityFaqIds: ["GF-002", "GF-001"],
  },
  {
    name: "positioning_boundary",
    patterns: [/(定位刷新|边界判断|边界判定|定位能力|定位精度|定位准|判定能力)/],
    queryHints: ["F860 的定位与边界判定能力如何？", "能否识别室内外环境，减少误报？"],
    priorityFaqIds: ["GF-006", "GF-007"],
  },
  {
    name: "purchase_info",
    patterns: [/(在哪里买|哪里买|怎么买|购买|发售|发售信息|官网|购买渠道|购买入口)/],
    queryHints: ["F860 在哪里可以购买或了解发售信息？"],
    priorityFaqIds: ["GF-015"],
  },
  {
    name: "waterproof_durability",
    patterns: [/(防水|防尘|雨天|下雨|淋雨|海边|沙滩|户外防护|ip67|耐候)/i],
    queryHints: ["F860 户外环境下防护能力怎么样？"],
    priorityFaqIds: ["GF-008"],
  },
  {
    name: "usage_scenarios",
    patterns: [/(适用场景|适合.*场景|哪些场景|什么场景|什么环境|农场|牧场|露营|庭院|郊区住宅)/],
    queryHints: ["F860 适用于哪些真实养犬场景？"],
    priorityFaqIds: ["GF-017"],
  },
  {
    name: "language_support",
    patterns: [/(支持.*语言|语言支持|多语言|中文|英文|法文|语种)/],
    queryHints: ["系统支持哪些语言？"],
    priorityFaqIds: ["GF-014"],
  },
  {
    name: "activity_insights",
    patterns: [/(行为追踪|运动数据|活动数据|数据洞察|能看.*数据|越界记录|行为模式)/],
    queryHints: ["App 界面能提供哪些洞察？", "F860 是否提供行为追踪与活动洞察？"],
    priorityFaqIds: ["GF-011", "GF-010"],
  },
  {
    name: "material_cleaning",
    patterns: [/(材质|清洁|清洗|好洗|耐用|项圈材料|维护)/],
    queryHints: ["项圈材质和清洁维护如何？"],
    priorityFaqIds: ["GF-009"],
  },
  {
    name: "product_advantages",
    patterns: [/(优势|亮点|卖点|好处|核心价值|为什么选|特点|优点)/],
    queryHints: [
      "F860 相比传统方案有哪些优势？",
      "F860 能解决什么核心问题？",
      "F860 的定位与边界判定能力如何？",
      "F860 户外环境下防护能力怎么样？",
      "F860 是否提供行为追踪与活动洞察？",
    ],
    priorityFaqIds: ["GF-020", "GF-003", "GF-006", "GF-007", "GF-008", "GF-010", "GF-017"],
  },
  {
    name: "product_usage",
    patterns: [
      /(怎么用|怎么使用|如何使用|使用方法|使用步骤|使用教程|上手指南|怎么上手|新手|第一次用|如何设置|怎么设置|如何操作|操作流程)/,
    ],
    queryHints: [
      "F860 怎么快速上手使用？",
      "围栏能自定义吗？最多可以保存多少组？",
      "F860 的定位与边界判定能力如何？",
      "App 界面能提供哪些洞察？",
      "F860 适用于哪些真实养犬场景？",
    ],
    priorityFaqIds: ["GF-019", "GF-005", "GF-006", "GF-011", "GF-017", "GF-003"],
  },
];

const unsupportedTopicPatterns = [
  /(充电|充不进电|充不了电|无法充电|充电失败)/,
  /(电池|电量|续航|耗电|掉电|待机)/,
  /(不开机|开不了机|无法开机|关机|死机|黑屏)/,
  /(充电器|充电线|type-?c|接口|插口)/i,
];

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const aliasPatterns = termAliasGroups
  .flatMap((group) =>
    group.aliases.map((alias) => ({
      alias,
      canonical: group.canonical,
      regex: new RegExp(escapeRegex(alias), "gi"),
    })),
  )
  .sort((a, b) => b.alias.length - a.alias.length);

function normalizeTerminology(text) {
  let normalized = String(text || "");
  if (!normalized) return normalized;
  for (const item of aliasPatterns) {
    normalized = normalized.replace(item.regex, item.canonical);
  }
  return normalized;
}

function detectQueryIntent(text) {
  const normalized = normalizeTerminology(text).replace(/\s+/g, "");
  if (!normalized) return null;
  for (const profile of queryIntentProfiles) {
    if (profile.patterns.some((pattern) => pattern.test(normalized))) {
      return profile;
    }
  }
  return null;
}

function isLikelyUnsupportedTopic(text) {
  const normalized = normalizeTerminology(text).replace(/\s+/g, "");
  if (!normalized) return false;
  return unsupportedTopicPatterns.some((pattern) => pattern.test(normalized));
}

function dedupeStrings(items, limit = queryVariantLimit) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const value = String(item || "").trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function buildQueryPlan(query) {
  const normalizedQuery = normalizeTerminology(query);
  const intent = detectQueryIntent(normalizedQuery);
  const intentHints = intent?.queryHints || [];
  const variants = dedupeStrings([
    normalizedQuery,
    ...intentHints,
    intentHints[0] ? `${normalizedQuery}\n${intentHints[0]}` : "",
  ]);

  return {
    normalizedQuery,
    intentName: intent?.name || "",
    priorityFaqIds: intent?.priorityFaqIds || [],
    variants: variants.length ? variants : [normalizedQuery],
  };
}

function isDecisionQuestion(text) {
  const normalized = normalizeTerminology(text).replace(/\s+/g, "");
  if (!normalized) return false;

  if (
    /(需要吗|要吗|要不要|需不需要|是否|能否|可否|是不是|有没有|能不能|可不可以|行不行|支持吗|可以吗)/.test(
      normalized,
    )
  ) {
    return true;
  }

  return /(吗|么|？|\?)$/.test(normalized) && /(订阅|收费|付费|支持|开启|关闭|绑定|告警)/.test(normalized);
}

async function appendJsonArray(fileName, item) {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, fileName);

  let list = [];
  try {
    const raw = await fs.readFile(filePath, "utf8");
    list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  list.push(item);
  await fs.writeFile(filePath, JSON.stringify(list, null, 2));
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !body[field]);
  return missing;
}

function buildSessionKey(userId, sessionId) {
  return `${userId}::${sessionId}`;
}

function parseHandoffDecision(message) {
  const text = String(message || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();

  if (
    /^(需要|要|是|好的|好|可以|行|转人工|yes|y|ok)$/.test(text) ||
    (text.includes("转人工") && !text.includes("不"))
  ) {
    return "yes";
  }

  if (
    /^(不需要|不要|不用|否|不用了|先不用|暂时不用|no|n)$/.test(text) ||
    text.includes("不需要") ||
    text.includes("不用")
  ) {
    return "no";
  }

  return "unknown";
}

function tokenizeForOverlap(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  const tokens = new Set();

  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    if (gram.trim()) tokens.add(gram);
  }

  return tokens;
}

function computeLexicalMatch(query, candidateText) {
  const qTokens = tokenizeForOverlap(query);
  const cTokens = tokenizeForOverlap(candidateText);
  if (!qTokens.size || !cTokens.size) return 0;

  let hits = 0;
  for (const token of qTokens) {
    if (cTokens.has(token)) hits += 1;
  }
  return hits / qTokens.size;
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`invalid_jsonl line=${index + 1} ${err.message}`);
      }
    });
}

function tokenizeForBm25(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  const tokens = [];

  for (let i = 0; i < normalized.length - 1; i += 1) {
    const gram = normalized.slice(i, i + 2);
    if (gram.trim()) {
      tokens.push(gram);
    }
  }
  return tokens;
}

function buildBm25Index(rows) {
  const docs = [];
  const docFreq = new Map();
  let totalLen = 0;

  for (const row of rows) {
    const payload = {
      chunk_id: row.chunk_id || "",
      faq_id: row.faq_id || "",
      question: row.question || "",
      answer: row.answer || "",
      chunk_text: row.chunk_text || "",
    };
    const text = `${payload.question}\n${payload.answer}\n${payload.chunk_text}`;
    const tokens = tokenizeForBm25(text);
    const tf = new Map();
    const seen = new Set();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
      if (!seen.has(token)) {
        seen.add(token);
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    totalLen += tokens.length;
    docs.push({
      key: payload.chunk_id || payload.faq_id || payload.question,
      payload,
      tf,
      len: tokens.length,
    });
  }

  const docCount = docs.length;
  const avgDocLen = docCount ? totalLen / docCount : 0;
  const idf = new Map();
  for (const [token, df] of docFreq.entries()) {
    const value = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    idf.set(token, value);
  }

  return {
    docs,
    idf,
    avgDocLen,
    k1: 1.2,
    b: 0.75,
  };
}

async function ensureBm25Index() {
  if (bm25IndexPromise) {
    return bm25IndexPromise;
  }

  bm25IndexPromise = (async () => {
    try {
      const raw = await fs.readFile(chunksFilePath, "utf8");
      const rows = parseJsonl(raw);
      return buildBm25Index(rows);
    } catch (err) {
      console.warn("bm25_index_load_failed", err?.message || err);
      return buildBm25Index([]);
    }
  })();

  return bm25IndexPromise;
}

function bm25Score(queryTokens, doc, index) {
  if (!queryTokens.length || !doc.len || !index.avgDocLen) {
    return 0;
  }

  const uniqueQueryTokens = [...new Set(queryTokens)];
  let score = 0;

  for (const token of uniqueQueryTokens) {
    const tf = doc.tf.get(token) || 0;
    if (!tf) continue;

    const idf = index.idf.get(token) || 0;
    const numerator = tf * (index.k1 + 1);
    const denominator =
      tf + index.k1 * (1 - index.b + (index.b * doc.len) / index.avgDocLen);
    score += idf * (numerator / denominator);
  }

  return score;
}

async function bm25Search(query, limit) {
  const index = await ensureBm25Index();
  if (!index.docs.length) {
    return [];
  }

  const queryTokens = tokenizeForBm25(query);
  const scored = [];

  for (const doc of index.docs) {
    const score = bm25Score(queryTokens, doc, index);
    if (score > 0) {
      scored.push({
        key: doc.key,
        score,
        payload: doc.payload,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function denseScoreToUnit(score) {
  if (!Number.isFinite(score)) return 0;
  if (score > 1) return 1;
  if (score < 0) return 0;
  return score;
}

function candidateKey(payload, fallback) {
  return (
    payload?.chunk_id ||
    payload?.faq_id ||
    payload?.question ||
    payload?.answer ||
    fallback
  );
}

function fuseAndRerank(query, denseHits, bm25Hits, limit) {
  const merged = new Map();

  denseHits.forEach((hit, index) => {
    const key = candidateKey(hit.payload, `dense_${index}`);
    const prev = merged.get(key) || {
      key,
      payload: hit.payload || {},
      denseScore: 0,
      bm25Score: 0,
      denseRank: Number.POSITIVE_INFINITY,
      bm25Rank: Number.POSITIVE_INFINITY,
    };
    prev.payload = hit.payload || prev.payload;
    prev.denseScore = Math.max(prev.denseScore, Number(hit.score || 0));
    prev.denseRank = Math.min(prev.denseRank, index + 1);
    merged.set(key, prev);
  });

  bm25Hits.forEach((hit, index) => {
    const key = candidateKey(hit.payload, `bm25_${index}`);
    const prev = merged.get(key) || {
      key,
      payload: hit.payload || {},
      denseScore: 0,
      bm25Score: 0,
      denseRank: Number.POSITIVE_INFINITY,
      bm25Rank: Number.POSITIVE_INFINITY,
    };
    prev.payload = hit.payload || prev.payload;
    prev.bm25Score = Math.max(prev.bm25Score, Number(hit.score || 0));
    prev.bm25Rank = Math.min(prev.bm25Rank, index + 1);
    merged.set(key, prev);
  });

  const candidates = [...merged.values()];
  const maxBm25 = Math.max(0, ...candidates.map((item) => item.bm25Score));

  const withRrf = candidates.map((item) => {
    const denseRrf = Number.isFinite(item.denseRank)
      ? 1 / (hybridRrfK + item.denseRank)
      : 0;
    const bm25Rrf = Number.isFinite(item.bm25Rank)
      ? 1 / (hybridRrfK + item.bm25Rank)
      : 0;

    return {
      ...item,
      rrfScore: denseRrf + bm25Rrf,
    };
  });

  withRrf.sort((a, b) => b.rrfScore - a.rrfScore);
  const preselect = withRrf.slice(0, Math.max(limit * 3, 10));

  const reranked = preselect.map((item) => {
    const payload = item.payload || {};
    const candidateText = `${payload.question || ""}\n${payload.answer || ""}`;
    const lexical = computeLexicalMatch(query, candidateText);
    const denseUnit = denseScoreToUnit(item.denseScore);
    const bm25Unit = maxBm25 ? item.bm25Score / maxBm25 : 0;
    const score =
      rerankWeightDense * denseUnit +
      rerankWeightBm25 * bm25Unit +
      rerankWeightLexical * lexical;

    return {
      score,
      dense_score: denseUnit,
      bm25_score: bm25Unit,
      lexical_match: lexical,
      rrf_score: item.rrfScore,
      payload,
    };
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, limit);
}

function buildTicketId() {
  return `ticket_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

async function createHandoffTicket({
  userId,
  sessionId,
  question,
  contact = "",
  appContext = {},
  source = "manual",
  reason = "",
  retrieval = {},
}) {
  const ticketId = buildTicketId();
  const now = new Date().toISOString();

  await appendJsonArray("handoff_tickets.json", {
    ticketId,
    timestamp: now,
    userId,
    sessionId,
    question,
    contact,
    appContext,
    status: "open",
    source,
    reason,
    retrieval,
  });

  return { ticketId, now };
}

function buildEmbeddingHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (embeddingApiKey) {
    headers.Authorization = `Bearer ${embeddingApiKey}`;
  }
  return headers;
}

function buildQdrantHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (qdrantApiKey) {
    headers["api-key"] = qdrantApiKey;
  }
  return headers;
}

async function createQueryEmbedding(text) {
  const resp = await fetch(`${embeddingBaseUrl}/embeddings`, {
    method: "POST",
    headers: buildEmbeddingHeaders(),
    body: JSON.stringify({
      model: embeddingModel,
      input: `search_query: ${text}`,
      encoding_format: "float",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `embedding_failed ${resp.status} ${resp.statusText} ${body}`,
    );
  }

  const json = await resp.json();
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || !vector.length) {
    throw new Error("embedding_failed invalid_response");
  }
  return vector;
}

async function denseSearchByVector(vector, limit) {
  const resp = await fetch(
    `${qdrantUrl}/collections/${qdrantCollection}/points/search`,
    {
      method: "POST",
      headers: buildQdrantHeaders(),
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
        with_vector: false,
      }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `qdrant_search_failed ${resp.status} ${resp.statusText} ${body}`,
    );
  }

  const json = await resp.json();
  const result = Array.isArray(json?.result) ? json.result : [];
  return result.map((hit) => ({
    score: Number(hit.score || 0),
    payload: hit.payload || {},
  }));
}

async function searchByVariant(query, limit) {
  const [vector, bm25Hits] = await Promise.all([
    createQueryEmbedding(query),
    bm25Search(query, bm25CandidateK),
  ]);
  const denseHits = await denseSearchByVector(vector, denseCandidateK);
  return fuseAndRerank(query, denseHits, bm25Hits, limit);
}

function mergeVariantHits(variantResults, limit, priorityFaqIds = []) {
  const merged = new Map();

  for (const variantResult of variantResults) {
    const variant = variantResult?.variant || "";
    const hits = Array.isArray(variantResult?.hits) ? variantResult.hits : [];
    const seenInVariant = new Set();

    hits.forEach((hit, index) => {
      const key = candidateKey(hit.payload, `${variant}_${index}`);
      const prev = merged.get(key) || {
        score: 0,
        dense_score: 0,
        bm25_score: 0,
        lexical_match: 0,
        rrf_score: 0,
        payload: hit.payload || {},
        variant_match_count: 0,
        query_variants: [],
      };

      if (!seenInVariant.has(key)) {
        prev.variant_match_count += 1;
        seenInVariant.add(key);
      }
      if (!prev.query_variants.includes(variant)) {
        prev.query_variants.push(variant);
      }

      prev.payload = hit.payload || prev.payload;
      prev.score = Math.max(Number(prev.score || 0), Number(hit.score || 0));
      prev.dense_score = Math.max(
        Number(prev.dense_score || 0),
        Number(hit.dense_score || 0),
      );
      prev.bm25_score = Math.max(
        Number(prev.bm25_score || 0),
        Number(hit.bm25_score || 0),
      );
      prev.lexical_match = Math.max(
        Number(prev.lexical_match || 0),
        Number(hit.lexical_match || 0),
      );
      prev.rrf_score = Math.max(
        Number(prev.rrf_score || 0),
        Number(hit.rrf_score || 0),
      );
      merged.set(key, prev);
    });
  }

  const reranked = [...merged.values()].map((item) => {
    const variantBoost = Math.min(
      0.03,
      Math.max(0, item.variant_match_count - 1) * 0.015,
    );
    const faqId = item.payload?.faq_id || "";
    const priorityIndex = priorityFaqIds.indexOf(faqId);
    const intentBoost =
      priorityIndex >= 0 ? Math.max(0.08, 0.3 - priorityIndex * 0.03) : 0;
    return {
      ...item,
      score: Number((item.score + variantBoost + intentBoost).toFixed(6)),
    };
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, limit);
}

async function searchKnowledgeBase(query, options = {}) {
  if (!qdrantUrl) {
    return [];
  }

  const plan = buildQueryPlan(query);
  const limit = Number(options.limit || ragTopK);
  const variantLimit = Math.max(10, limit * 2);
  const variantResults = await Promise.all(
    plan.variants.map(async (variant) => ({
      variant,
      hits: await searchByVariant(variant, variantLimit),
    })),
  );

  return mergeVariantHits(variantResults, limit, plan.priorityFaqIds);
}

function formatFaqContext(hits) {
  if (!hits.length) {
    return "无检索结果";
  }

  return hits
    .map((hit, idx) => {
      const p = hit.payload || {};
      return [
        `候选${idx + 1} score=${hit.score.toFixed(4)}`,
        `faq_id=${p.faq_id || "-"}`,
        `question=${p.question || "-"}`,
        `answer=${p.answer || "-"}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildFallbackReply(hits) {
  const trusted = hits.filter((hit) => hit.score >= ragScoreThreshold);
  const best = trusted[0] || hits[0];

  if (!best) {
    return "抱歉，这个问题我暂时无法回答，你可以联系人工客服获取帮助。";
  }

  const answer = best.payload?.answer;
  if (!answer) {
    return "抱歉，这个问题我暂时无法回答，你可以联系人工客服获取帮助。";
  }

  return answer;
}

function pickAnswerByFaq(hits, faqId) {
  const hit = hits.find((item) => item.payload?.faq_id === faqId);
  return String(hit?.payload?.answer || "").trim();
}

function pickTopAnswers(hits, count = 3) {
  return hits
    .map((item) => String(item.payload?.answer || "").trim())
    .filter(Boolean)
    .slice(0, count);
}

function buildIntentPresetReply(intentName, hits) {
  if (!intentName || !Array.isArray(hits) || !hits.length) return "";

  const canonicalByIntent = {
    purchase_info: "GF-015",
    waterproof_durability: "GF-008",
    usage_scenarios: "GF-017",
    language_support: "GF-014",
    material_cleaning: "GF-009",
    positioning_boundary: "GF-006",
  };
  const canonicalFaqId = canonicalByIntent[intentName];
  if (canonicalFaqId) {
    const canonical = pickAnswerByFaq(hits, canonicalFaqId);
    if (canonical) return canonical;
  }

  if (intentName === "product_advantages") {
    const canonical = pickAnswerByFaq(hits, "GF-020");
    if (canonical) return canonical;
    const a1 = pickAnswerByFaq(hits, "GF-003");
    const a2 = pickAnswerByFaq(hits, "GF-006");
    const a3 = pickAnswerByFaq(hits, "GF-008");
    const fallback = pickTopAnswers(hits, 3);
    const points = [a1, a2, a3].filter(Boolean);
    const list = (points.length >= 2 ? points : fallback).slice(0, 3);
    if (!list.length) return "";
    return [
      "F860 的主要优势可以概括为：",
      ...list.map((item, idx) => `${idx + 1}. ${item}`),
    ].join("\n");
  }

  if (intentName === "product_usage") {
    const canonical = pickAnswerByFaq(hits, "GF-019");
    if (canonical) return canonical;
    const step1 = pickAnswerByFaq(hits, "GF-005");
    const step2 = pickAnswerByFaq(hits, "GF-006");
    const step3 = pickAnswerByFaq(hits, "GF-011");
    const fallback = pickTopAnswers(hits, 3);
    const steps = [step1, step2, step3].filter(Boolean);
    const list = (steps.length >= 2 ? steps : fallback).slice(0, 3);
    if (!list.length) return "";
    return [
      "你可以按下面步骤上手 F860：",
      ...list.map((item, idx) => `${idx + 1}. ${item}`),
    ].join("\n");
  }

  if (intentName === "activity_insights") {
    const appView = pickAnswerByFaq(hits, "GF-011");
    const behavior = pickAnswerByFaq(hits, "GF-010");
    const list = [appView, behavior].filter(Boolean);
    if (list.length === 1) return list[0];
    if (list.length >= 2) {
      return [
        "F860 的数据洞察主要包括：",
        `1. ${list[0]}`,
        `2. ${list[1]}`,
      ].join("\n");
    }
  }

  return "";
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ai-cs-service",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    qdrantConfigured: Boolean(qdrantUrl),
    embeddingConfigured: Boolean(embeddingBaseUrl && embeddingModel),
    ragCollection: qdrantCollection,
    autoHandoffEnabled,
    autoHandoffThreshold,
    answerConfidenceThreshold,
    lexicalMatchMin,
    directAnswerMinScore,
    decisionQuestionMinScore,
    decisionQuestionLexicalMin,
    semanticMatchMinDense,
    semanticLexicalFloor,
    intentAnswerMinScore,
    queryVariantLimit,
    unknownTopicScoreMax,
    unknownTopicDenseMax,
    unknownTopicLexicalMax,
    denseCandidateK,
    bm25CandidateK,
    hybridRrfK,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/retrieve", async (req, res) => {
  const query = String(req.body?.query || "").trim();
  if (!query) {
    return res.status(400).json({
      error: "missing_query",
      message: "query is required",
    });
  }

  const topK = Math.max(1, Math.min(20, Number(req.body?.topK || ragTopK)));

  try {
    const hits = await searchKnowledgeBase(query, { limit: topK });
    return res.json({
      query,
      topK,
      hits: hits.map((hit) => ({
        score: Number(hit.score.toFixed(4)),
        dense_score: Number(hit.dense_score.toFixed(4)),
        bm25_score: Number(hit.bm25_score.toFixed(4)),
        lexical_match: Number(hit.lexical_match.toFixed(4)),
        rrf_score: Number(hit.rrf_score.toFixed(6)),
        faq_id: hit.payload?.faq_id || "",
        question: hit.payload?.question || "",
        answer: hit.payload?.answer || "",
        chunk_id: hit.payload?.chunk_id || "",
      })),
    });
  } catch (err) {
    console.error("retrieve_failed", err);
    return res.status(500).json({
      error: "retrieve_failed",
      message: err?.message || "unknown_error",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const required = ["userId", "sessionId", "message"];
  const missing = requireFields(req.body || {}, required);
  if (missing.length) {
    return res.status(400).json({
      error: "missing_fields",
      missing,
    });
  }

  const { userId, sessionId, message, appContext = {} } = req.body;
  const sessionKey = buildSessionKey(userId, sessionId);
  const contextText = [
    `platform=${appContext.platform || "unknown"}`,
    `appVersion=${appContext.appVersion || "unknown"}`,
    `pageCode=${appContext.pageCode || "unknown"}`,
  ].join(", ");

  try {
    const pending = pendingHandoffConfirmations.get(sessionKey);
    if (pending) {
      const expired = Date.now() - pending.createdAt > pendingHandoffTtlMs;
      if (expired) {
        pendingHandoffConfirmations.delete(sessionKey);
      } else {
        const decision = parseHandoffDecision(message);
        if (decision === "yes") {
          const ticket = await createHandoffTicket({
            userId,
            sessionId,
            question: pending.originalQuestion,
            appContext: pending.appContext,
            source: "user_confirmed_handoff",
            reason: pending.reason || "user_confirmed_handoff",
            retrieval: pending.retrieval || {},
          });
          pendingHandoffConfirmations.delete(sessionKey);

          const now = new Date().toISOString();
          const reply = `好的，已为你转接人工客服，工单号：${ticket.ticketId}。`;
          const handoff = {
            triggered: true,
            ticketId: ticket.ticketId,
            reason: "user_confirmed_handoff",
            topScore: pending.topScore,
            threshold: autoHandoffThreshold,
            needsConfirmation: false,
          };

          await appendJsonArray("messages.json", {
            timestamp: now,
            userId,
            sessionId,
            message,
            reply,
            appContext,
            retrieval: pending.retrieval || {},
            handoff,
          });

          return res.json({
            sessionId,
            reply,
            sources: pending.sources || [],
            handoff,
            timestamp: now,
          });
        }

        if (decision === "no") {
          pendingHandoffConfirmations.delete(sessionKey);

          const now = new Date().toISOString();
          const reply = "好的，暂不转接人工。你可以补充更多细节，我继续帮你排查。";
          const handoff = {
            triggered: false,
            ticketId: "",
            reason: "user_declined_handoff",
            topScore: pending.topScore,
            threshold: autoHandoffThreshold,
            needsConfirmation: false,
          };

          await appendJsonArray("messages.json", {
            timestamp: now,
            userId,
            sessionId,
            message,
            reply,
            appContext,
            retrieval: pending.retrieval || {},
            handoff,
          });

          return res.json({
            sessionId,
            reply,
            sources: pending.sources || [],
            handoff,
            timestamp: now,
          });
        }

        const now = new Date().toISOString();
        const reply = "请回复“需要”或“不需要”，我再为你处理是否转接人工客服。";
        const handoff = {
          triggered: false,
          ticketId: "",
          reason: "awaiting_handoff_confirmation",
          topScore: pending.topScore,
          threshold: autoHandoffThreshold,
          needsConfirmation: true,
          options: ["需要", "不需要"],
        };

        await appendJsonArray("messages.json", {
          timestamp: now,
          userId,
          sessionId,
          message,
          reply,
          appContext,
          retrieval: pending.retrieval || {},
          handoff,
        });

        return res.json({
          sessionId,
          reply,
          sources: pending.sources || [],
          handoff,
          timestamp: now,
        });
      }
    }

    let retrievalError = "";
    let hits = [];
    const normalizedMessage = normalizeTerminology(message);
    const queryIntent = detectQueryIntent(normalizedMessage);
    try {
      hits = await searchKnowledgeBase(message);
    } catch (err) {
      retrievalError = err?.message || "retrieval_unknown_error";
      console.error("retrieval_failed", err);
    }

    let reply = "";
    if (openaiClient) {
      try {
        const completion = await openaiClient.chat.completions.create({
          model: chatModel,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: assistantSystemPrompt,
            },
            {
              role: "user",
              content: [
                `App context: ${contextText}`,
                `User question: ${message}`,
                `Normalized question: ${normalizedMessage}`,
                `Knowledge base context:\n${formatFaqContext(hits)}`,
              ].join("\n\n"),
            },
          ],
        });

        reply = completion.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("chat_completion_failed", err);
      }
    }

    if (!reply) {
      const presetReply = buildIntentPresetReply(queryIntent?.name || "", hits);
      reply = presetReply || buildFallbackReply(hits);
    }

    const sources = hits.map((hit) => ({
      score: Number(hit.score.toFixed(4)),
      dense_score: Number((hit.dense_score || 0).toFixed(4)),
      bm25_score: Number((hit.bm25_score || 0).toFixed(4)),
      lexical_match: Number((hit.lexical_match || 0).toFixed(4)),
      faq_id: hit.payload?.faq_id || "",
      question: hit.payload?.question || "",
    }));

    const topScore = hits[0]?.score || 0;
    const topDenseScore = Number(hits[0]?.dense_score || 0);
    const topPayload = hits[0]?.payload || {};
    const topCandidateText = `${topPayload.question || ""}\n${topPayload.answer || ""}`;
    const normalizedTopCandidateText = normalizeTerminology(topCandidateText);
    const lexicalMatch =
      Number(hits[0]?.lexical_match || 0) ||
      computeLexicalMatch(normalizedMessage, normalizedTopCandidateText);

    const hasTopAnswer = Boolean(String(topPayload.answer || "").trim());
    const decisionQuestion = isDecisionQuestion(message);
    const unsupportedTopic = isLikelyUnsupportedTopic(message) && !queryIntent;
    const lowConfidenceNoIntent =
      !queryIntent &&
      topScore <= unknownTopicScoreMax &&
      topDenseScore <= unknownTopicDenseMax &&
      lexicalMatch <= unknownTopicLexicalMax;
    const shouldReturnUnknown = unsupportedTopic || lowConfidenceNoIntent;
    const semanticMatched =
      (topDenseScore >= semanticMatchMinDense || topScore >= directAnswerMinScore) &&
      (Boolean(queryIntent) || lexicalMatch >= semanticLexicalFloor);
    const intentDrivenAnswer =
      Boolean(queryIntent) &&
      topScore >= intentAnswerMinScore &&
      topDenseScore >= semanticMatchMinDense * 0.9;
    const shouldPreferDirectAnswer =
      !shouldReturnUnknown &&
      hasTopAnswer &&
      (topScore >= answerConfidenceThreshold ||
        intentDrivenAnswer ||
        (topDenseScore >= semanticMatchMinDense &&
          topScore >= intentAnswerMinScore) ||
        (topScore >= directAnswerMinScore && lexicalMatch >= lexicalMatchMin) ||
        (decisionQuestion &&
          topScore >= decisionQuestionMinScore &&
          lexicalMatch >= decisionQuestionLexicalMin));

    const shouldAutoHandoff =
      autoHandoffEnabled &&
      !shouldReturnUnknown &&
      (hits.length === 0 ||
        (!semanticMatched &&
          (topScore < autoHandoffThreshold || lexicalMatch < lexicalMatchMin)));

    const shouldClarify =
      !shouldReturnUnknown && !shouldAutoHandoff && !shouldPreferDirectAnswer;

    let handoff = {
      triggered: false,
      ticketId: "",
      reason: "",
      topScore,
      threshold: autoHandoffThreshold,
      needsConfirmation: false,
      lexicalMatch: Number(lexicalMatch.toFixed(4)),
      answerThreshold: answerConfidenceThreshold,
      topDenseScore: Number(topDenseScore.toFixed(4)),
      semanticMatchMinDense,
      semanticLexicalFloor,
      unsupportedTopic,
      lowConfidenceNoIntent,
      intent: queryIntent?.name || "",
    };

    if (shouldReturnUnknown) {
      reply = "抱歉，这个问题我暂时无法回答，你可以联系人工客服获取帮助。";
      handoff.reason = unsupportedTopic
        ? "unsupported_topic"
        : "low_relevance_without_intent";
    }

    if (shouldClarify) {
      reply =
        "为了给你准确答复，请补充两个信息：1）你现在所在的App页面；2）你已经尝试过的操作步骤。";
      handoff.reason = "needs_clarification";
    }

    if (shouldAutoHandoff) {
      const reason =
        hits.length === 0
          ? "no_retrieval_hits"
          : topScore < autoHandoffThreshold
            ? `top_score_below_threshold_${topScore.toFixed(4)}`
            : `lexical_match_below_threshold_${lexicalMatch.toFixed(4)}`;
      pendingHandoffConfirmations.set(sessionKey, {
        createdAt: Date.now(),
        originalQuestion: message,
        appContext,
        reason,
        topScore,
        lexicalMatch: Number(lexicalMatch.toFixed(4)),
        sources,
        retrieval: {
          error: retrievalError,
          topScore,
          topDenseScore,
          threshold: autoHandoffThreshold,
          lexicalMatch: Number(lexicalMatch.toFixed(4)),
          lexicalMatchMin,
          semanticMatchMinDense,
          intent: queryIntent?.name || "",
          answerConfidenceThreshold,
          topHits: hits.map((hit) => ({
            score: hit.score,
            faq_id: hit.payload?.faq_id || "",
            question: hit.payload?.question || "",
          })),
        },
      });

      handoff = {
        triggered: false,
        ticketId: "",
        reason,
        topScore,
        threshold: autoHandoffThreshold,
        needsConfirmation: true,
        options: ["需要", "不需要"],
        lexicalMatch: Number(lexicalMatch.toFixed(4)),
        answerThreshold: answerConfidenceThreshold,
      };

      reply =
        "抱歉，我暂时无法准确理解您的问题，需要为您转接人工客服吗？";
    }

    const now = new Date().toISOString();
    await appendJsonArray("messages.json", {
      timestamp: now,
      userId,
      sessionId,
      message,
      reply,
      appContext,
      retrieval: {
        error: retrievalError,
        topScore,
        topDenseScore,
        threshold: autoHandoffThreshold,
        lexicalMatch: Number(lexicalMatch.toFixed(4)),
        lexicalMatchMin,
        semanticMatchMinDense,
        intent: queryIntent?.name || "",
        answerConfidenceThreshold,
        topHits: hits.map((hit) => ({
          score: hit.score,
          faq_id: hit.payload?.faq_id || "",
          question: hit.payload?.question || "",
        })),
      },
    });

    return res.json({
      sessionId,
      reply,
      sources,
      handoff,
      timestamp: now,
    });
  } catch (err) {
    console.error("chat_failed", err);
    return res.status(500).json({
      error: "chat_failed",
      message: err?.message || "unknown_error",
    });
  }
});

app.post("/api/feedback", async (req, res) => {
  const required = ["userId", "sessionId", "rating"];
  const missing = requireFields(req.body || {}, required);
  if (missing.length) {
    return res.status(400).json({
      error: "missing_fields",
      missing,
    });
  }

  const { userId, sessionId, rating, comment = "", messageId = "" } = req.body;
  const now = new Date().toISOString();

  await appendJsonArray("feedback.json", {
    timestamp: now,
    userId,
    sessionId,
    rating,
    comment,
    messageId,
  });

  return res.json({ ok: true, timestamp: now });
});

app.post("/api/handoff", async (req, res) => {
  const required = ["userId", "sessionId", "question"];
  const missing = requireFields(req.body || {}, required);
  if (missing.length) {
    return res.status(400).json({
      error: "missing_fields",
      missing,
    });
  }

  const { userId, sessionId, question, contact = "", appContext = {} } = req.body;
  const ticket = await createHandoffTicket({
    userId,
    sessionId,
    question,
    contact,
    appContext,
    source: "manual_api_handoff",
    reason: "manual_request",
  });

  return res.json({
    ok: true,
    ticketId: ticket.ticketId,
    message: "人工工单已创建",
  });
});

app.listen(port, () => {
  console.log(`AI CS service running on http://localhost:${port}`);
});
