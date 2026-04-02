const test = require("node:test");
const assert = require("node:assert/strict");

const { fuseAndRerank } = require("./retrieval_rerank");

test("fuseAndRerank should use chunk_text for lexical rerank", () => {
  const query = "项圈掉下来";
  const denseHits = [
    {
      score: 0.7,
      payload: {
        faq_id: "F860-028",
        question: "如何连接接收器？",
        answer: "打开 APP 连接设备。",
        chunk_text: "分类：连接故障\n标准问题：如何连接接收器？\n答案：打开 APP 连接设备。",
      },
    },
    {
      score: 0.55,
      payload: {
        faq_id: "F860-003",
        question: "项圈容易脱落、不够紧怎么办？",
        answer: "重新调节佩戴方式并检查扣环。",
        chunk_text:
          "分类：安全与使用体验\n标准问题：项圈容易脱落、不够紧怎么办？\n相似问题：项圈掉下来 | 佩戴不牢固\n答案：重新调节佩戴方式并检查扣环。",
      },
    },
  ];

  const hits = fuseAndRerank(query, denseHits, [], 3, {
    hybridRrfK: 60,
    rerankWeightDense: 0.62,
    rerankWeightBm25: 0.16,
    rerankWeightLexical: 0.22,
  });

  assert.equal(hits[0].payload.faq_id, "F860-003");
  assert.ok(hits[0].lexical_match > hits[1].lexical_match);
});
