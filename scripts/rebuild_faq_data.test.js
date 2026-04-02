const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeFaqRows,
  buildFaqChunks,
  buildEvalQueries,
} = require("./rebuild_faq_data");

test("normalizeFaqRows builds stable faq records from excel rows", () => {
  const rows = [
    {
      question: "设备无法开机怎么办？",
      similarQuestions:
        "开不了机|无法启动|设备打不开|设备无法开机怎么办？| 开不了机 ",
      category: "开机故障",
      answer: "先充电 30 分钟，再长按电源键重试。",
    },
    {
      question: "项圈容易脱落怎么办？",
      similarQuestions: "项圈太松|佩戴不牢固",
      category: "安全与使用体验",
      answer: "重新调节长度，确保贴合但不压迫。",
    },
  ];

  const faqs = normalizeFaqRows(rows);

  assert.equal(faqs.length, 2);
  assert.deepEqual(faqs[0], {
    faq_id: "F860-001",
    category: "开机故障",
    question: "设备无法开机怎么办？",
    answer: "先充电 30 分钟，再长按电源键重试。",
    similar_questions: ["开不了机", "无法启动", "设备打不开"],
  });
  assert.equal(faqs[1].faq_id, "F860-002");
});

test("buildFaqChunks keeps compatibility with current retrieval format", () => {
  const faqs = [
    {
      faq_id: "F860-001",
      category: "开机故障",
      question: "设备无法开机怎么办？",
      answer: "先充电 30 分钟，再长按电源键重试。",
      similar_questions: ["开不了机", "无法启动"],
    },
  ];

  const chunks = buildFaqChunks(faqs);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_id, "chunk_001");
  assert.equal(chunks[0].faq_id, "F860-001");
  assert.equal(chunks[0].question, "设备无法开机怎么办？");
  assert.match(chunks[0].chunk_text, /分类：开机故障/);
  assert.match(chunks[0].chunk_text, /标准问题：设备无法开机怎么办？/);
  assert.match(chunks[0].chunk_text, /相似问题：开不了机 \| 无法启动/);
  assert.match(chunks[0].chunk_text, /答案：先充电 30 分钟，再长按电源键重试。/);
});

test("buildEvalQueries expands standard and similar questions", () => {
  const faqs = [
    {
      faq_id: "F860-001",
      category: "开机故障",
      question: "设备无法开机怎么办？",
      answer: "先充电 30 分钟，再长按电源键重试。",
      similar_questions: ["开不了机", "无法启动"],
    },
  ];

  const queries = buildEvalQueries(faqs);

  assert.deepEqual(queries, [
    {
      query: "设备无法开机怎么办？",
      expected_faq_id: "F860-001",
    },
    {
      query: "开不了机",
      expected_faq_id: "F860-001",
    },
    {
      query: "无法启动",
      expected_faq_id: "F860-001",
    },
  ]);
});

test("normalizeFaqRows filters blanks and preserves multiline answers", () => {
  const rows = [
    {
      question: "充电没反应怎么办？",
      similarQuestions: " | 不能充电 |充电没反应怎么办？|  ",
      category: "充电故障",
      answer: "1. 检查充电线。\n2. 更换插头后重试。",
    },
  ];

  const faqs = normalizeFaqRows(rows);

  assert.deepEqual(faqs[0].similar_questions, ["不能充电"]);
  assert.equal(faqs[0].answer, "1. 检查充电线。\n2. 更换插头后重试。");
});
