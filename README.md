# AI Customer Service (Mobile App)

This service is designed for in-app support in an existing mobile app.

## 1) Setup

```bash
cd /Users/jaycie/Desktop/AI/ai-cs-service
npm install
cp .env.example .env
```

Edit `.env`:

```env
PORT=3001
OPENAI_API_KEY=your_real_key_optional
EMBEDDING_BASE_URL=http://127.0.0.1:1234/v1
EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
EMBEDDING_API_KEY=lm-studio
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your_qdrant_key
QDRANT_COLLECTION=faq_chunks
RAG_TOP_K=5
DENSE_CANDIDATE_K=20
BM25_CANDIDATE_K=20
HYBRID_RRF_K=60
RERANK_WEIGHT_DENSE=0.62
RERANK_WEIGHT_BM25=0.16
RERANK_WEIGHT_LEXICAL=0.22
RAG_SCORE_THRESHOLD=0.58
AUTO_HANDOFF_ENABLED=true
AUTO_HANDOFF_THRESHOLD=0.6
ANSWER_CONFIDENCE_THRESHOLD=0.78
LEXICAL_MATCH_MIN=0.15
DIRECT_ANSWER_MIN_SCORE=0.6
DECISION_QUESTION_MIN_SCORE=0.68
DECISION_QUESTION_LEXICAL_MIN=0.45
SEMANTIC_MATCH_MIN_DENSE=0.6
SEMANTIC_LEXICAL_FLOOR=0.18
INTENT_ANSWER_MIN_SCORE=0.56
QUERY_VARIANT_LIMIT=4
UNKNOWN_TOPIC_SCORE_MAX=0.64
UNKNOWN_TOPIC_DENSE_MAX=0.74
UNKNOWN_TOPIC_LEXICAL_MAX=0.16
PENDING_HANDOFF_TTL_MS=600000
```

Reason:
- `OPENAI_API_KEY` is optional now. If configured, server will rewrite/refine answer with LLM.
- If `OPENAI_API_KEY` is empty, server will still answer directly from Qdrant retrieval result.
- App calls this server through HTTP APIs.

## 2) Run

```bash
npm run dev
```

If you only need production run:

```bash
npm start
```

## 2.1) Run Full Flow Tests

Use this command to verify end-to-end core flows:
- health
- retrieve
- chat (normal / unsupported topic)
- feedback
- handoff
- handoff confirmation (yes / no / pending)

```bash
npm run test:flows
```

## 3) API Contracts

### `GET /health`

Checks server status.

### `POST /api/chat`

Behavior:
- retrieve with hybrid pipeline: dense vector + local BM25, then RRF fusion and weighted rerank
- use semantic query variants (original query + intent hints) so meaning-similar phrasing can still hit the right FAQ
- use vector score + lexical match to reduce off-topic answers
- "是否/能否/要不要"这类问题命中明确知识时优先直接给结论，不强制先追问
- "产品优势/怎么使用/怎么上手"等高频话术会走预设意图召回，减少字面不一致导致的误判
- 购买渠道、防水能力、适用场景、语言支持、行为洞察、材质清洁等也使用预设意图直答
- 对知识库未覆盖主题（如充电/电池）启用拦截，直接返回“暂时无法回答”，避免答非所问
- medium confidence only asks clarification when top answer is still ambiguous
- return answer from retrieval directly (or refine with LLM if `OPENAI_API_KEY` is configured) only when confidence is high enough
- when retrieval confidence is low, ask user whether to transfer to human agent
- only create handoff ticket after user confirms with "需要"

Tuning tips:
- lower `ANSWER_CONFIDENCE_THRESHOLD` to return answers more aggressively
- lower `DECISION_QUESTION_MIN_SCORE` if yes/no questions are still over-clarified
- lower `DECISION_QUESTION_LEXICAL_MIN` to relax lexical strictness for short yes/no questions
- lower `SEMANTIC_MATCH_MIN_DENSE` if paraphrase queries are still being treated as low confidence
- raise `SEMANTIC_LEXICAL_FLOOR` if semantic retrieval still causes off-topic answers
- lower `UNKNOWN_TOPIC_*` thresholds to make unknown-topic fallback trigger earlier
- lower `INTENT_ANSWER_MIN_SCORE` if intent queries are still over-clarified
- raise `QUERY_VARIANT_LIMIT` to add more intent expansion variants
- raise `LEXICAL_MATCH_MIN` to reduce off-topic answers
- raise `RERANK_WEIGHT_LEXICAL` to suppress semantic-but-off-topic retrieval
- increase `DENSE_CANDIDATE_K`/`BM25_CANDIDATE_K` for harder long-tail queries

Request:

```json
{
  "userId": "u1",
  "sessionId": "s1",
  "message": "怎么开启电子围栏告警？",
  "appContext": {
    "platform": "android",
    "appVersion": "1.0.0",
    "pageCode": "fence_settings"
  }
}
```

### `POST /api/feedback`

Request:

```json
{
  "userId": "u1",
  "sessionId": "s1",
  "rating": "up",
  "comment": "有帮助"
}
```

### `POST /api/handoff`

Request:

```json
{
  "userId": "u1",
  "sessionId": "s1",
  "question": "我找不到设备绑定入口",
  "contact": "13800000000",
  "appContext": {
    "platform": "android",
    "appVersion": "1.0.0",
    "pageCode": "device_home"
  }
}
```

### `POST /api/retrieve`

Use this to inspect pure retrieval quality without chat generation.

Request:

```json
{
  "query": "F860 需要订阅费吗？",
  "topK": 5
}
```

## 4) WebView Quick Launch (Recommended for first validation)

After `npm run dev`, open this embeddable page:

`http://127.0.0.1:3001/h5/chat`

You can also pass context by query string:

```text
http://127.0.0.1:3001/h5/chat?title=在线客服&platform=android&appVersion=1.2.3&pageCode=home&userId=u1001&sessionId=s9001
```

Supported query params:
- `title`: page title shown in header
- `welcome`: first welcome message
- `placeholder`: input placeholder
- `apiBase`: backend base URL, default same-origin
- `endpoint`: chat API path, default `/api/chat`
- `userId`: user id (auto-generated if empty)
- `sessionId`: session id (auto-generated if empty)
- `platform`: e.g. `ios` / `android` / `webview`
- `appVersion`: app version
- `pageCode`: page identifier for analytics
- `hideHeader=1`: hide top header (good for full-screen in-app UI)
- `suggestions`: comma-separated quick questions

Why this page is WebView-friendly:
- pure native HTML/CSS/JS (no framework runtime required)
- works in iOS/Android WebView, Flutter WebView, React Native WebView
- keyboard and safe-area handling for mobile screens

### 4.1 JS Bridge (optional)

H5 will emit events to native:
- `ready`
- `message_sent`
- `message_received`
- `error`

Outbound channels:
- `window.ReactNativeWebView.postMessage(...)`
- `window.webkit.messageHandlers.chatBridge.postMessage(...)`
- `window.parent.postMessage(...)`

Native can send commands to H5 via `postMessage` with JSON:

```json
{"type":"set_context","payload":{"userId":"u1","sessionId":"s1","platform":"ios","appVersion":"1.0.0","pageCode":"home"}}
```

Supported inbound types:
- `set_config`
- `set_context`
- `send_message`
- `clear`

## 5) Local Persistence

Current MVP stores data in:
- `data/messages.json`
- `data/feedback.json`
- `data/handoff_tickets.json`

Next step should be migration to a real DB.

## 6) Build Embeddings And Upsert To Qdrant

1. Ensure LM Studio local server is running and exposes embeddings at `http://127.0.0.1:1234/v1`.
2. Fill `.env` with:

```env
EMBEDDING_BASE_URL=http://127.0.0.1:1234/v1
EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
EMBEDDING_API_KEY=lm-studio
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your_qdrant_key
QDRANT_COLLECTION=faq_chunks
QDRANT_RECREATE=true
```

3. Run:

```bash
npm run embed:qdrant
```

This script will:
- read `faq_chunks.jsonl`
- generate embeddings using `search_document:` prefix
- recreate and upsert points into Qdrant
- run a test query using `search_query:` prefix

## 7) Quick Chat Test

```bash
curl http://127.0.0.1:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u1",
    "sessionId": "s1",
    "message": "F860 需要订阅费吗？",
    "appContext": {"platform":"ios","appVersion":"1.0.0","pageCode":"home"}
  }'
```

## 8) Web Test Page (Internal Lab)

After `npm run dev`, open:

`http://127.0.0.1:3001`

Page capabilities:
- send chat messages directly to `/api/chat`
- show retrieved sources and handoff status
- one-click reply with `需要` or `不需要` to complete handoff confirmation flow

## 9) Retrieval Evaluation

1. Keep server running (`npm run dev`).
2. Run:

```bash
npm run eval:retrieval
```

Default eval set is `eval_queries.jsonl` with fields:

```json
{"query":"这个设备要不要每月订阅费","expected_faq_id":"GF-002"}
```

Output metrics:
- `top1`
- `top3`
- `mrr`

Use these metrics to compare parameter changes in `.env`.
