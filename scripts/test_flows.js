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
  if (/(优势|特点|亮点|卖点|好处)/.test(text)) {
    return [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(清洁|维护|防水|耐用)/.test(text)) {
    return [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(使用场景有哪些要求|适合室内使用吗|适用哪些犬类)/.test(text)) {
    return [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(未改变狗狗行为怎么办|怎么训练才有效|需要训犬师吗)/.test(text)) {
    return [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(如何连接接收器|怎么设置电子围栏|第一次怎么用|如何操作)/.test(text)) {
    return [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(围栏是否始终准确触发|围栏触发延迟是正常吗|信号异常时围栏还能用吗|会不会误报|会不会乱报)/.test(text)) {
    return [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(设备无法充电怎么办|充电时间过长|长期未使用后如何处理|充不上电|充不进电)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(产品无法启动怎么办|产品无法正常使用怎么办|开不了机|不工作了)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(返回后还在报警|警报停不下来|安全区内却警报|明明没出界却一直误报警)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(项圈容易脱落|扣环扣不紧|项圈掉下来|佩戴不牢固|项圈松紧要怎么调)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(丢了能找到吗|定位准吗|能完全防止走失吗|可以完全依赖吗|防丢失效果如何)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(按了没反应|按键按不动|按键弹不起来|按键会自己误触发)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(攻击性狗狗可以用吗|颈围要求是多少|多大的狗能用|小型犬能用吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(有几种工作模式|一共有哪几种模式|围栏模式和训狗模式怎么切换)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(很容易坏|使用寿命短|经常出故障|一进水就容易坏)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(狗带不结实|狗带突然断裂|狗带耳朵裂了|狗带扣子坏了)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(首次使用需要注意什么|怎么训练才有效)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(搜不到GPS|GPS没信号|信号突然消失|定位不上怎么办)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(一天用不到就关机|续航这么短|电量掉得特别快|充一次用不久|低温续航差)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(围栏页面一直转圈|连接加载失败|围栏界面连不上|进入围栏界面总提示连接失败)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(越界后不报警|围栏明明开着却不报警|报警功能不生效|出界后不工作)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(围栏画得太小会不会更容易触发|围栏画小一点会不会更准|把围栏缩小后效果会更好吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(关闭围栏后进出还会工作吗|把围栏关掉后报警还会不会触发|关闭围栏以后设备还会自动纠正吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(开机有提示音|开启后一直响|开机响3分钟|提示音不停)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(功能没激活|越界没反应|宠物出界不惩罚|功能一直激活失败怎么办)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(收到货发现少了配件|配件损坏了该怎么处理|收到货配件缺失|运输途中损坏了怎么办)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  }
  if (/(震动没反应|电击没效果|静音功能失效|静态刺激无效|无震动无静音怎么办)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  }
  if (/(多个围栏|好几个围栏|一次性建多个围栏|同时创建多个围栏)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  }
  if (/(修改围栏|编辑围栏|调整围栏范围|围栏创建后可以修改吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
  }
  if (/(触发有点慢|围栏报警有延迟|为什么出界后不是立刻触发|触发延迟正常吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
  }
  if (/(创建围栏时.*佩戴|先不戴在狗身上能不能创建围栏|画围栏的时候设备一定要先戴上吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0];
  }
  if (/(只报警不惩罚|超出范围没反应|误报超出距离|警报后无动作|显示超出安全距离但未受到处罚)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
  }
  if (/(室内能用吗|在家里室内能直接用围栏吗|室内信号不好还能用这个产品吗)/.test(text)) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  }
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
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
              chunk_id: "chunk_014",
              faq_id: "F860-014",
              question: "产品有哪些核心特点？",
              answer: "无需埋线、支持多种围栏形状、支持越界提醒和手动训练模式。",
            },
          },
          {
            score: 0.86,
            payload: {
              chunk_id: "chunk_011",
              faq_id: "F860-011",
              question: "产品是什么，能解决什么问题？",
              answer: "这是基于 GPS 的电子围栏辅助管理产品。",
            },
          },
        ];
      } else if (vector[1] >= 0.9) {
        result = [
          {
            score: 0.72,
            payload: {
              chunk_id: "chunk_045",
              faq_id: "F860-045",
              question: "如何正确清洁和维护设备",
              answer: "每周清洁、每月检查，长期不用时保持干燥并定期补电。",
            },
          },
          {
            score: 0.67,
            payload: {
              chunk_id: "chunk_018",
              faq_id: "F860-018",
              question: "产品耐用性差，使用时间短容易损坏？",
              answer: "重点是防进水、防摔咬、定期清洁和正确存放。",
            },
          },
        ];
      } else if (vector[2] >= 0.9) {
        result = [
          {
            score: 0.9,
            payload: {
              chunk_id: "chunk_013",
              faq_id: "F860-013",
              question: "产品的使用场景有哪些要求？",
              answer: "需在户外开阔无遮挡区域使用，室内或树下等弱信号环境不适合。",
            },
          },
          {
            score: 0.84,
            payload: {
              chunk_id: "chunk_015",
              faq_id: "F860-015",
              question: "产品适合室内使用吗？",
              answer: "围栏依赖卫星定位，室内通常无法正常工作。",
            },
          },
        ];
      } else if (vector[3] >= 0.9) {
        result = [
          {
            score: 0.91,
            payload: {
              chunk_id: "chunk_007",
              faq_id: "F860-007",
              question: "产品未改变狗狗行为怎么办？",
              answer: "本产品是训练辅助工具，需要配合互动训练和持续练习。",
            },
          },
          {
            score: 0.83,
            payload: {
              chunk_id: "chunk_044",
              faq_id: "F860-044",
              question: "狗狗需要接受专门训练才能使用围栏吗",
              answer: "需要训练，建议每天 10-15 分钟循序渐进适应围栏。",
            },
          },
        ];
      } else if (vector[4] >= 0.9) {
        result = [
          {
            score: 0.92,
            payload: {
              chunk_id: "chunk_028",
              faq_id: "F860-028",
              question: "如何连接接收器？",
              answer: "先开机，再打开 APP 添加设备并连接接收器。",
            },
          },
          {
            score: 0.85,
            payload: {
              chunk_id: "chunk_030",
              faq_id: "F860-030",
              question: "是否可以同时创建多个围栏？",
              answer: "可以创建多个围栏，但一次只能启用一个。",
            },
          },
        ];
      } else if (vector[5] >= 0.9) {
        result = [
          {
            score: 0.9,
            payload: {
              chunk_id: "chunk_034",
              faq_id: "F860-034",
              question: "围栏是否始终准确触发？",
              answer: "无法保证每种环境都精确触发，实际效果会受环境和定位精度影响。",
            },
          },
          {
            score: 0.84,
            payload: {
              chunk_id: "chunk_036",
              faq_id: "F860-036",
              question: "当设备显示信号异常时，我还能使用围栏吗？",
              answer: "信号异常时围栏可能暂时无法工作，请移至开阔区域。",
            },
          },
        ];
      } else if (vector[6] >= 0.9) {
        result = [
          {
            score: 0.91,
            payload: {
              chunk_id: "chunk_020",
              faq_id: "F860-020",
              question: "设备无法充电怎么办？",
              answer: "先换原装充电配件，再清洁充电口，持续充电 10-20 分钟后重试。",
            },
          },
          {
            score: 0.85,
            payload: {
              chunk_id: "chunk_021",
              faq_id: "F860-021",
              question: "充电时间过长/充不满",
              answer: "优先检查充电器、线材和充电环境。",
            },
          },
        ];
      } else if (vector[7] >= 0.9) {
        result = [
          {
            score: 0.9,
            payload: {
              chunk_id: "chunk_027",
              faq_id: "F860-027",
              question: "产品无法启动怎么办？",
              answer: "先充电 30 分钟，再检查充电配件和充电口。",
            },
          },
          {
            score: 0.82,
            payload: {
              chunk_id: "chunk_039",
              faq_id: "F860-039",
              question: "产品无法正常使用怎么办？",
              answer: "先排查电量、环境和省电状态，再看是否存在硬件异常。",
            },
          },
        ];
      } else if (vector[8] >= 0.9) {
        result = [
          {
            score: 0.93,
            payload: {
              chunk_id: "chunk_002",
              faq_id: "F860-002",
              question: "宠物在安全区内却警报/返回后警报继续怎么办？",
              answer: "避开信号干扰、改善信号环境，并适当增大安全区域范围。",
            },
          },
          {
            score: 0.81,
            payload: {
              chunk_id: "chunk_040",
              faq_id: "F860-040",
              question: "显示超出安全距离但未受到处罚怎么办？",
              answer: "检查信号情况并重新调节边界范围。",
            },
          },
        ];
      } else if (vector[9] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_003",
              faq_id: "F860-003",
              question: "项圈容易脱落、不够紧怎么办？",
              answer: "调整颈带贴合颈部，检查扣环并保留一指宽空隙。",
            },
          },
          {
            score: 0.8,
            payload: {
              chunk_id: "chunk_019",
              faq_id: "F860-019",
              question: "接收器狗带耳朵断裂",
              answer: "检查狗带裂纹并避免爆冲拉扯。",
            },
          },
        ];
      } else if (vector[10] >= 0.9) {
        result = [
          {
            score: 0.92,
            payload: {
              chunk_id: "chunk_008",
              faq_id: "F860-008",
              question: "GPS围栏能100%防止宠物丢失吗？",
              answer: "无法保证100%防止走失，请勿完全依赖本产品。",
            },
          },
          {
            score: 0.84,
            payload: {
              chunk_id: "chunk_011",
              faq_id: "F860-011",
              question: "产品是什么，能解决什么问题？",
              answer: "这是用于宠物活动管理的 GPS 电子围栏辅助产品。",
            },
          },
        ];
      } else if (vector[11] >= 0.9) {
        result = [
          {
            score: 0.93,
            payload: {
              chunk_id: "chunk_010",
              faq_id: "F860-010",
              question: "按键卡键/不灵敏/重按/松动/失灵",
              answer: "先清理按键缝隙，再检查是否进水或按键弹片损坏。",
            },
          },
        ];
      } else if (vector[12] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_012",
              faq_id: "F860-012",
              question: "产品适用哪些犬类？",
              answer: "适用于中大型犬，体重 15-110 磅，颈围 9-26 英寸。",
            },
          },
        ];
      } else if (vector[13] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_016",
              faq_id: "F860-016",
              question: "产品有哪些工作模式？",
              answer: "支持训狗模式和围栏模式，可按需切换。",
            },
          },
        ];
      } else if (vector[14] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_018",
              faq_id: "F860-018",
              question: "产品耐用性差，使用时间短容易损坏？",
              answer: "重点是防进水、防摔咬、定期清洁并正确存放。",
            },
          },
        ];
      } else if (vector[15] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_019",
              faq_id: "F860-019",
              question: "接收器狗带耳朵断裂",
              answer: "先检查狗带裂纹和老化情况，避免爆冲拉扯，必要时更换。",
            },
          },
        ];
      } else if (vector[16] >= 0.9) {
        result = [
          {
            score: 0.9,
            payload: {
              chunk_id: "chunk_013",
              faq_id: "F860-013",
              question: "产品的使用场景有哪些要求？",
              answer: "首次使用要在户外开阔环境先测试设备反应。",
            },
          },
          {
            score: 0.88,
            payload: {
              chunk_id: "chunk_007",
              faq_id: "F860-007",
              question: "产品未改变狗狗行为怎么办？",
              answer: "需要用户持续互动训练，每次 10-15 分钟效果更好。",
            },
          },
        ];
      } else if (vector[17] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_001",
              faq_id: "F860-001",
              question: "无法搜索到GPS信号或丢失信号怎么办？",
              answer: "先到户外开阔无遮挡区域，再检查电量和干扰环境。",
            },
          },
        ];
      } else if (vector[18] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_022",
              faq_id: "F860-022",
              question: "电池不耐用、一天用不到就关机了？",
              answer: "先判断电池是否老化，再优化充电方式和日常使用习惯。",
            },
          },
        ];
      } else if (vector[19] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_029",
              faq_id: "F860-029",
              question: "围栏界面连接加载失败怎么处理？",
              answer: "先退出当前页面重进，再后台重启 APP 后重新连接。",
            },
          },
        ];
      } else if (vector[20] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_032",
              faq_id: "F860-032",
              question: "围栏已启用，但未触发报警，该怎么办？",
              answer: "先检查设备开机、定位状态和围栏是否已保存启用。",
            },
          },
        ];
      } else if (vector[21] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_035",
              faq_id: "F860-035",
              question: "绘制小范围围栏，围栏效果是否会更好？",
              answer: "不推荐把围栏画太小，太小反而容易频繁触发报警。",
            },
          },
        ];
      } else if (vector[22] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_038",
              faq_id: "F860-038",
              question: "关闭围栏后会发生什么？",
              answer: "关闭围栏后将不再触发围栏相关报警或纠正功能。",
            },
          },
        ];
      } else if (vector[23] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_041",
              faq_id: "F860-041",
              question: "机器开启时响起声音怎么办？",
              answer: "先确认是否超出安全范围或信号不足，通常信号恢复后会取消提示音。",
            },
          },
        ];
      } else if (vector[24] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_042",
              faq_id: "F860-042",
              question: "产品功能未被激活怎么办？",
              answer: "先看宠物是否真的处于触发条件，再确认 GPS 信号是否达到要求。",
            },
          },
        ];
      } else if (vector[25] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_043",
              faq_id: "F860-043",
              question: "缺少配件、配件损坏怎么办？",
              answer: "提供照片或视频证据，联系客服发起补发、维修或退货流程。",
            },
          },
        ];
      } else if (vector[26] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_025",
              faq_id: "F860-025",
              question: "无静音/无震动/静态刺激无效怎么办？",
              answer: "先检查静电模式锁定、电量、接触点和刺激强度。",
            },
          },
        ];
      } else if (vector[27] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_030",
              faq_id: "F860-030",
              question: "是否可以同时创建多个围栏？",
              answer: "可以同时创建多个围栏，但一次只能启用一个无线围栏。",
            },
          },
        ];
      } else if (vector[28] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_031",
              faq_id: "F860-031",
              question: "围栏创建后可以修改吗？",
              answer: "可以在无线围栏设置页面调整围栏形状或边界并保存。",
            },
          },
        ];
      } else if (vector[29] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_033",
              faq_id: "F860-033",
              question: "围栏触发延迟是正常吗？",
              answer: "是正常现象，触发会受环境、信号质量和宠物移动速度影响。",
            },
          },
        ];
      } else if (vector[30] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_037",
              faq_id: "F860-037",
              question: "创建围栏时，设备是否需要宠物佩戴？",
              answer: "不需要，只要设备开机并已获取定位信息即可先创建围栏。",
            },
          },
        ];
      } else if (vector[31] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_040",
              faq_id: "F860-040",
              question: "显示超出安全距离但未受到处罚怎么办？",
              answer: "先检查信号、调整边界范围，再重启设备重新定位中心点。",
            },
          },
        ];
      } else if (vector[32] >= 0.9) {
        result = [
          {
            score: 0.94,
            payload: {
              chunk_id: "chunk_015",
              faq_id: "F860-015",
              question: "产品适合室内使用吗？",
              answer: "围栏依赖卫星定位，室内或严重遮挡环境通常无法正常工作。",
            },
          },
        ];
      } else {
        result = [
          {
            score: 0.62,
            payload: {
              chunk_id: "chunk_028",
              faq_id: "F860-028",
              question: "如何连接接收器？",
              answer: "先开机，再打开 APP 添加设备并连接接收器。",
            },
          },
          {
            score: 0.58,
            payload: {
              chunk_id: "chunk_017",
              faq_id: "F860-017",
              question: "设备可以创建那些类型的围栏？",
              answer: "当前支持圆形、多边形和自由手绘围栏。",
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
      } else {
        result = [
          {
            score: 0.58,
            payload: {
              chunk_id: "chunk_028",
              faq_id: "F860-028",
              question: "如何连接接收器？",
              answer: "先开机，再打开 APP 添加设备并连接接收器。",
            },
          },
          {
            score: 0.56,
            payload: {
              chunk_id: "chunk_014",
              faq_id: "F860-014",
              question: "产品有哪些核心特点？",
              answer:
                "无需埋线、支持多种围栏形状、支持越界提醒和手动训练模式。",
            },
          },
          {
            score: 0.54,
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
      message: "产品优势是什么？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat normal",
  );
  assert.match(chatNormal.reply, /无需埋线|围栏形状|越界提醒|手动训练/, "chat normal reply unexpected");
  assert.equal("handoff" in chatNormal, false, "chat should not expose handoff info");

  const chatSceneParaphrase = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_scene",
      sessionId: "s_scene",
      message: "在哪里可以用？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat scene paraphrase",
  );
  assert.match(chatSceneParaphrase.reply, /户外开阔|室内|弱信号环境/, "scene paraphrase reply unexpected");

  const chatEffectParaphrase = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_effect",
      sessionId: "s_effect",
      message: "没效果怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat effect paraphrase",
  );
  assert.match(chatEffectParaphrase.reply, /训练辅助工具|互动训练|10-15 分钟/, "effect paraphrase reply unexpected");

  const chatUsageParaphrase = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_usage",
      sessionId: "s_usage",
      message: "第一次咋弄",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat usage paraphrase",
  );
  assert.match(chatUsageParaphrase.reply, /开机|APP|连接接收器/, "usage paraphrase reply unexpected");

  const chatBoundaryParaphrase = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_boundary",
      sessionId: "s_boundary",
      message: "会不会乱报",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat boundary paraphrase",
  );
  assert.match(chatBoundaryParaphrase.reply, /无法保证|环境|定位精度|信号异常/, "boundary paraphrase reply unexpected");

  const chatChargingParaphrase = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_charge",
      sessionId: "s_charge",
      message: "充不上电",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat charging paraphrase",
  );
  assert.match(chatChargingParaphrase.reply, /充电配件|充电口|充电 10-20 分钟/, "charging paraphrase reply unexpected");

  const chatStartupParaphrase = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_startup",
      sessionId: "s_startup",
      message: "开不了咋办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat startup paraphrase",
  );
  assert.match(chatStartupParaphrase.reply, /充电 30 分钟|充电配件|充电口/, "startup paraphrase reply unexpected");

  const chatFalseAlarm = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_false_alarm",
      sessionId: "s_false_alarm",
      message: "返回后还在报警",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat false alarm",
  );
  assert.match(chatFalseAlarm.reply, /信号干扰|安全区域|增大安全区域/, "false alarm reply unexpected");

  const chatLooseCollar = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_loose",
      sessionId: "s_loose",
      message: "项圈扣环扣不紧怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat loose collar",
  );
  assert.match(chatLooseCollar.reply, /贴合颈部|扣环|一指宽/, "loose collar reply unexpected");

  const chatAntiLoss = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_anti_loss",
      sessionId: "s_anti_loss",
      message: "定位准吗",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat anti loss",
  );
  assert.match(chatAntiLoss.reply, /无法保证100%|完全依赖|走失/, "anti loss reply unexpected");

  const chatButtonIssue = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_button",
      sessionId: "s_button",
      message: "按了没反应",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat button issue",
  );
  assert.match(chatButtonIssue.reply, /按键|进水|弹片|缝隙/, "button issue reply unexpected");

  const chatApplicableDogs = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_dogs",
      sessionId: "s_dogs",
      message: "攻击性狗狗可以用吗？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat applicable dogs",
  );
  assert.match(chatApplicableDogs.reply, /中大型犬|15-110|攻击性较强/, "applicable dogs reply unexpected");

  const chatModes = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_modes",
      sessionId: "s_modes",
      message: "这个设备一共有哪几种模式",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat modes",
  );
  assert.match(chatModes.reply, /训狗模式|围栏模式|切换/, "modes reply unexpected");

  const chatDurability = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_durability",
      sessionId: "s_durability",
      message: "这个设备是不是很容易坏",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat durability",
  );
  assert.match(chatDurability.reply, /防进水|定期清洁|正确存放|防摔咬/, "durability reply unexpected");

  const chatStrapIssue = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_strap",
      sessionId: "s_strap",
      message: "狗带不结实",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat strap issue",
  );
  assert.match(chatStrapIssue.reply, /狗带|裂纹|爆冲|更换/, "strap issue reply unexpected");

  const chatFirstUse = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_first_use",
      sessionId: "s_first_use",
      message: "首次使用需要注意什么？",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat first use",
  );
  assert.match(chatFirstUse.reply, /首次使用|户外开阔|测试设备反应/, "first use reply unexpected");

  const chatGpsSignal = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_gps",
      sessionId: "s_gps",
      message: "搜不到GPS怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat gps signal",
  );
  assert.match(chatGpsSignal.reply, /开阔|GPS|信号|电量/, "gps signal reply unexpected");

  const chatBatteryDrain = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_battery",
      sessionId: "s_battery",
      message: "为什么一天就没电了",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat battery drain",
  );
  assert.match(chatBatteryDrain.reply, /电池|老化|原装|低温|关机/, "battery drain reply unexpected");

  const chatFencePageLoad = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_fence_page",
      sessionId: "s_fence_page",
      message: "围栏页面一直转圈怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat fence page load",
  );
  assert.match(chatFencePageLoad.reply, /返回|重进|重启 APP|重新连接/, "fence page load reply unexpected");

  const chatFenceNoAlarm = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_fence_no_alarm",
      sessionId: "s_fence_no_alarm",
      message: "围栏明明开着却不报警",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat fence no alarm",
  );
  assert.match(chatFenceNoAlarm.reply, /开机|定位|围栏|启用/, "fence no alarm reply unexpected");

  const chatSmallFence = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_small_fence",
      sessionId: "s_small_fence",
      message: "把围栏画小一点会不会更准",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat small fence",
  );
  assert.match(chatSmallFence.reply, /不推荐|范围太小|频繁触发|围栏范围/, "small fence reply unexpected");

  const chatFenceDisabled = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_fence_disabled",
      sessionId: "s_fence_disabled",
      message: "把围栏关掉后报警还会不会触发",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat fence disabled",
  );
  assert.match(chatFenceDisabled.reply, /关闭围栏|不再提供|报警|其他设备功能/, "fence disabled reply unexpected");

  const chatStartupBeep = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_startup_beep",
      sessionId: "s_startup_beep",
      message: "开机一直响",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat startup beep",
  );
  assert.match(chatStartupBeep.reply, /安全范围|GPS|信号|提示音/, "startup beep reply unexpected");

  const chatInactiveFeature = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_inactive_feature",
      sessionId: "s_inactive_feature",
      message: "宠物出界后设备怎么一点动作都没有",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat inactive feature",
  );
  assert.match(chatInactiveFeature.reply, /超出安全范围|未移动|亮红灯|GPS 信号|警报功能/, "inactive feature reply unexpected");

  const chatMissingAccessory = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_missing_accessory",
      sessionId: "s_missing_accessory",
      message: "收到货发现少了配件怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat missing accessory",
  );
  assert.match(chatMissingAccessory.reply, /照片|视频|补发|维修|退货/, "missing accessory reply unexpected");

  const chatStimulusInvalid = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_stimulus_invalid",
      sessionId: "s_stimulus_invalid",
      message: "震动没反应怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat stimulus invalid",
  );
  assert.match(chatStimulusInvalid.reply, /静电模式|电量|接触点|强度/, "stimulus invalid reply unexpected");

  const chatMultipleFences = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_multi_fence",
      sessionId: "s_multi_fence",
      message: "能不能一次性建多个围栏",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat multiple fences",
  );
  assert.match(chatMultipleFences.reply, /多个围栏|一次只能启用一个|切换/, "multiple fences reply unexpected");

  const chatEditFence = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_edit_fence",
      sessionId: "s_edit_fence",
      message: "围栏怎么编辑",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat edit fence",
  );
  assert.match(chatEditFence.reply, /调整围栏形状|边界|保存/, "edit fence reply unexpected");

  const chatFenceDelay = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_fence_delay",
      sessionId: "s_fence_delay",
      message: "为什么出界后不是立刻触发",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat fence delay",
  );
  assert.match(chatFenceDelay.reply, /正常|环境|信号质量|移动速度/, "fence delay reply unexpected");

  const chatFenceWear = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_fence_wear",
      sessionId: "s_fence_wear",
      message: "画围栏的时候设备一定要先戴上吗",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat fence wear",
  );
  assert.match(chatFenceWear.reply, /不需要|开机状态|定位信息|绘制围栏/, "fence wear reply unexpected");

  const chatOnlyAlarm = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_only_alarm",
      sessionId: "s_only_alarm",
      message: "只报警不惩罚怎么办",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat only alarm",
  );
  assert.match(chatOnlyAlarm.reply, /信号|边界范围|重新定位中心点/, "only alarm reply unexpected");

  const chatIndoorUse = assertJsonResponse(
    await request(baseUrl, "POST", "/api/chat", {
      userId: "u_indoor_use",
      sessionId: "s_indoor_use",
      message: "在家里室内能直接用围栏吗",
      appContext: { platform: "ios", appVersion: "1.0.0", pageCode: "home" },
    }),
    200,
    "chat indoor use",
  );
  assert.match(chatIndoorUse.reply, /室内|卫星定位|无法正常工作|开阔户外/, "indoor use reply unexpected");

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
  assert.match(
    chatUnsupported.reply,
    /换配件|充电口|充电10-20分钟|充电套装/,
    "chat charging reply unexpected",
  );
  assert.equal("handoff" in chatUnsupported, false, "charging reply should not expose handoff info");

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
      message: "产品优势是什么？",
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
  assert.match(
    chat.reply,
    /无需埋线|围栏形状|越界提醒|手动训练/,
    "stale intent should answer with F860 advantage content",
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
