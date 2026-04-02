const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BASE_DIR = path.resolve(__dirname, "..");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPort() {
  return 3100 + Math.floor(Math.random() * 500);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function embeddingFor(input) {
  const text = String(input || "");
  if (/(订阅|月费|年费|收费|付费|套餐)/.test(text)) {
    return [1, 0, 0];
  }
  if (/(充电|电池|续航|电量|充不进电)/.test(text)) {
    return [0, 1, 0];
  }
  return [0, 0, 1];
}

async function startMockRagServer() {
  const server = http.createServer(async (req, res) => {
    const pathName = String(req.url || "").split("?")[0];

    if (req.method === "POST" && pathName === "/v1/embeddings") {
      const body = await readRequestJson(req);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const data = inputs.map((item, index) => ({
        index,
        embedding: embeddingFor(item),
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data }));
      return;
    }

    if (
      req.method === "POST" &&
      /^\/collections\/[^/]+\/points\/search$/.test(pathName)
    ) {
      const body = await readRequestJson(req);
      const vector = Array.isArray(body.vector) ? body.vector : [];
      let result = [];

      if (vector[0] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_002",
              faq_id: "GF-002",
              question: "F860 需要订阅费吗？",
              answer: "不需要。F860 为“零订阅离线 GPS 电子围栏”。",
            },
          },
          {
            score: 0.86,
            payload: {
              chunk_id: "chunk_001",
              faq_id: "GF-001",
              question: "F860 是什么产品？",
              answer: "F860 是 Wellturn 发布的 GPS 电子围栏犬用设备。",
            },
          },
        ];
      } else if (vector[1] >= 0.9) {
        result = [
          {
            score: 0.72,
            payload: {
              chunk_id: "chunk_009",
              faq_id: "GF-009",
              question: "项圈材质和清洁维护如何？",
              answer: "F860 项圈使用 TPE 材料，易清洁且耐用。",
            },
          },
          {
            score: 0.67,
            payload: {
              chunk_id: "chunk_008",
              faq_id: "GF-008",
              question: "F860 户外环境下防护能力怎么样？",
              answer: "设备具备高等级户外防护，支持日常雨天场景。",
            },
          },
        ];
      } else {
        result = [
          {
            score: 0.62,
            payload: {
              chunk_id: "chunk_012",
              faq_id: "GF-012",
              question: "F860 是否支持品牌方/B 端合作？",
              answer: "支持品牌方与 B 端合作场景，可提供对接能力。",
            },
          },
          {
            score: 0.58,
            payload: {
              chunk_id: "chunk_019",
              faq_id: "GF-019",
              question: "F860 怎么快速上手使用？",
              answer: "你可以先在 App 新建围栏并进行场景化调试。",
            },
          },
        ];
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("mock_server_address_unavailable");
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function startStaleIntentMockRagServer() {
  const server = http.createServer(async (req, res) => {
    const pathName = String(req.url || "").split("?")[0];

    if (req.method === "POST" && pathName === "/v1/embeddings") {
      const body = await readRequestJson(req);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const data = inputs.map((item, index) => ({
        index,
        embedding: embeddingFor(item),
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data }));
      return;
    }

    if (
      req.method === "POST" &&
      /^\/collections\/[^/]+\/points\/search$/.test(pathName)
    ) {
      const body = await readRequestJson(req);
      const vector = Array.isArray(body.vector) ? body.vector : [];
      let result = [];

      if (vector[0] >= 0.9) {
        result = [
          {
            score: 0.7,
            payload: {
              chunk_id: "chunk_028",
              faq_id: "F860-028",
              question: "如何连接接收器？",
              answer: "先开机，再打开 APP 添加设备并连接接收器。",
            },
          },
          {
            score: 0.63,
            payload: {
              chunk_id: "chunk_011",
              faq_id: "F860-011",
              question: "产品是什么，能解决什么问题？",
              answer: "这是基于 GPS 的电子围栏辅助管理产品。",
            },
          },
        ];
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("mock_server_address_unavailable");
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function startAppServer(extraEnv = {}) {
  const port = randomPort();
  const env = {
    ...process.env,
    PORT: String(port),
    OPENAI_API_KEY: "",
    EMBEDDING_API_KEY: "",
    ...extraEnv,
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: BASE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const started = await waitForHealth(baseUrl, 10_000);
  if (!started) {
    child.kill("SIGTERM");
    throw new Error(`app_server_not_ready\n${logs}`);
  }

  return {
    baseUrl,
    stop: async () => {
      child.kill("SIGTERM");
      await delay(200);
    },
  };
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/health`);
      if (resp.ok) return true;
    } catch (err) {
      // ignore, server may still be booting
    }
    await delay(200);
  }
  return false;
}

async function request(baseUrl, method, apiPath, body) {
  const resp = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  const json = safeJsonParse(text);
  return { status: resp.status, json, text };
}

function assertJsonResponse(result, expectedStatus, label) {
  assert.equal(result.status, expectedStatus, `${label} unexpected status`);
  assert.ok(result.json && typeof result.json === "object", `${label} not json`);
  return result.json;
}

async function runDefaultFlowSuite(baseUrl) {
  const health = assertJsonResponse(
    await request(baseUrl, "GET", "/health"),
    200,
    "health",
  );
  assert.equal(health.ok, true, "health.ok should be true");
  assert.equal("llmProviderSetting" in health, false, "health should not expose llm settings");
  assert.equal("llmProviderResolved" in health, false, "health should not expose llm provider");
  assert.equal("chatModel" in health, false, "health should not expose chat model");
  assert.equal("ollamaConfigured" in health, false, "health should not expose ollama config");
  assert.equal("openaiConfigured" in health, false, "health should not expose openai config");
  assert.equal("autoHandoffEnabled" in health, false, "health should not expose handoff setting");
  assert.equal("autoHandoffThreshold" in health, false, "health should not expose handoff threshold");

  const missingFields = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_missing",
      sessionId: "s_missing",
    }),
    400,
    "chat missing fields",
  );
  assert.equal(missingFields.error, "missing_fields");

  const retrieve = assertJsonResponse(
    await request(baseUrl, "POST", "/api/retrieve", {
      query: "电子围栏怎么开启？",
      topK: 3,
    }),
    200,
    "retrieve",
  );
  assert.ok(Array.isArray(retrieve.hits), "retrieve.hits should be array");
  assert.ok(retrieve.hits.length > 0, "retrieve.hits should not be empty");

  const chatNormal = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u1",
      sessionId: "s1",
      message: "F860 需要订阅费吗？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat normal",
  );
  assert.match(chatNormal.reply, /不需要|零订阅/, "chat normal reply unexpected");
  assert.equal("handoff" in chatNormal, false, "chat should not expose handoff info");

  const chatUnsupported = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u2",
      sessionId: "s2",
      message: "这个设备充不进电怎么办？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat unsupported",
  );
  assert.equal(
    chatUnsupported.reply,
    "非常抱歉，当前这个问题我暂时无法直接解答。建议你直接联系购买产品的平台客服，他们会为你提供更精准的售后支持，帮你尽快解决问题。",
  );
  assert.equal("handoff" in chatUnsupported, false, "fallback should not expose handoff info");

  const feedback = assertJsonResponse(
    await request(baseUrl, "POST", "/api/feedback", {
      userId: "u1",
      sessionId: "s1",
      rating: "up",
      comment: "ok",
    }),
    200,
    "feedback",
  );
  assert.equal(feedback.ok, true);

  const handoffRemoved = await request(baseUrl, "POST", "/api/handoff", {
    userId: "u3",
    sessionId: "s3",
    question: "我找不到设备绑定入口",
    contact: "13800000000",
    appContext: { platform: "android", appVersion: "1.0.0", pageCode: "device_home" },
  });
  assert.equal(handoffRemoved.status, 404, "handoff endpoint should be removed");
}

async function runUnifiedFallbackSuite(baseUrl) {
  const fallback = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u4",
      sessionId: "s4",
      message: "请说一下定价规则",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "unified fallback",
  );
  assert.equal(
    fallback.reply,
    "非常抱歉，当前这个问题我暂时无法直接解答。建议你直接联系购买产品的平台客服，他们会为你提供更精准的售后支持，帮你尽快解决问题。",
  );
  assert.equal("handoff" in fallback, false, "fallback should not expose handoff info");

  const askAgain = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u4",
      sessionId: "s4",
      message: "稍等一下",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "fallback followup",
  );
  assert.equal(
    askAgain.reply,
    "非常抱歉，当前这个问题我暂时无法直接解答。建议你直接联系购买产品的平台客服，他们会为你提供更精准的售后支持，帮你尽快解决问题。",
  );
  assert.equal("handoff" in askAgain, false, "followup should not expose handoff info");
}

async function runStaleIntentSuite(baseUrl) {
  const chat = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_stale_intent",
      sessionId: "s_stale_intent",
      message: "F860 需要订阅费吗？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "stale intent chat",
  );

  assert.doesNotMatch(
    chat.reply,
    /连接接收器|添加设备/,
    "stale intent should not answer with unrelated setup guidance",
  );
  assert.equal(
    chat.reply,
    "非常抱歉，当前这个问题我暂时无法直接解答。建议你直接联系购买产品的平台客服，他们会为你提供更精准的售后支持，帮你尽快解决问题。",
  );
  assert.equal("handoff" in chat, false, "stale intent fallback should not expose handoff info");
}

async function main() {
  const mock = await startMockRagServer();
  const staleIntentMock = await startStaleIntentMockRagServer();
  let defaultServer = null;
  let fallbackServer = null;
  let staleIntentServer = null;

  try {
    defaultServer = await startAppServer({
      EMBEDDING_BASE_URL: `${mock.baseUrl}/v1`,
      QDRANT_URL: mock.baseUrl,
      QDRANT_COLLECTION: "faq_chunks",
    });
    await runDefaultFlowSuite(defaultServer.baseUrl);
    await defaultServer.stop();
    defaultServer = null;

    fallbackServer = await startAppServer({
      EMBEDDING_BASE_URL: `${mock.baseUrl}/v1`,
      QDRANT_URL: mock.baseUrl,
      QDRANT_COLLECTION: "faq_chunks",
      UNKNOWN_TOPIC_SCORE_MAX: "0",
      UNKNOWN_TOPIC_DENSE_MAX: "0",
      UNKNOWN_TOPIC_LEXICAL_MAX: "0",
    });
    await runUnifiedFallbackSuite(fallbackServer.baseUrl);
    await fallbackServer.stop();
    fallbackServer = null;

    staleIntentServer = await startAppServer({
      EMBEDDING_BASE_URL: `${staleIntentMock.baseUrl}/v1`,
      QDRANT_URL: staleIntentMock.baseUrl,
      QDRANT_COLLECTION: "faq_chunks",
    });
    await runStaleIntentSuite(staleIntentServer.baseUrl);
    await staleIntentServer.stop();
    staleIntentServer = null;

    console.log("flow tests passed");
  } finally {
    if (defaultServer) await defaultServer.stop();
    if (fallbackServer) await fallbackServer.stop();
    if (staleIntentServer) await staleIntentServer.stop();
    await mock.close();
    await staleIntentMock.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
