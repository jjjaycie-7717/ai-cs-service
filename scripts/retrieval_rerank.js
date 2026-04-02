function tokenizeForOverlap(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  const tokens = new Set();

  for (let i = 0; i < normalized.length - 1; i += 1) {
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

function buildCandidateText(payload) {
  return (
    payload?.chunk_text ||
    `${payload?.question || ""}\n${payload?.answer || ""}`
  );
}

function fuseAndRerank(query, denseHits, bm25Hits, limit, options) {
  const {
    hybridRrfK,
    rerankWeightDense,
    rerankWeightBm25,
    rerankWeightLexical,
  } = options;
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
    const lexical = computeLexicalMatch(query, buildCandidateText(payload));
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

module.exports = {
  fuseAndRerank,
};
