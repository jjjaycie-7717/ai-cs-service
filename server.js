const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs/promises");
const path = require("path");
const { fuseAndRerank: rerankSearchHits } = require("./scripts/retrieval_rerank");

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
const embeddingBaseUrl = (
  process.env.EMBEDDING_BASE_URL || "http://127.0.0.1:1234/v1"
).replace(/\/$/, "");
const embeddingModel =
  process.env.EMBEDDING_MODEL || "text-embedding-nomic-embed-text-v1.5";
const embeddingApiKey = process.env.EMBEDDING_API_KEY || "";

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
const answerConfidenceThreshold = envNumber("ANSWER_CONFIDENCE_THRESHOLD", 0.78);
const lexicalMatchMin = envNumber("LEXICAL_MATCH_MIN", 0.15);
const directAnswerMinScore = envNumber("DIRECT_ANSWER_MIN_SCORE", 0.6);
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
let bm25IndexPromise = null;
const greetingReply = "您可以直接说出遇到的产品问题哦～";
const genericFallbackReply =
  "非常抱歉，当前这个问题我暂时无法直接解答。建议你直接联系购买产品的平台客服，他们会为你提供更精准的售后支持，帮你尽快解决问题。";

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.get("/h5/chat", (req, res) => {
  res.sendFile(path.join(publicDir, "embed.html"));
});

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
    name: "anti_loss_reliability",
    patterns: [/(能完全防止走失吗|丢了能找到吗|定位准吗|可以完全依赖吗|防丢失效果如何|会不会丢|防走失靠谱吗)/],
    examples: ["丢了能找到吗？", "定位准吗？", "可以完全依赖吗？", "防丢失效果如何？", "能完全防止走失吗？"],
    queryHints: ["GPS围栏能100%防止宠物丢失吗？", "产品是什么，能解决什么问题？"],
    priorityFaqIds: ["F860-008", "F860-011"],
  },
  {
    name: "false_alarm_in_safe_zone",
    patterns: [/(安全区内却警报|返回后还在报警|警报停不下来|没出界却报警|无故报警|一直误报警)/],
    examples: ["返回后还在报警", "警报停不下来", "明明没出界却一直误报警", "安全区内还报警"],
    queryHints: ["宠物在安全区内却警报/返回后警报继续怎么办？"],
    priorityFaqIds: ["F860-002"],
  },
  {
    name: "collar_fit_issue",
    patterns: [/(项圈容易脱落|不够紧|项圈掉下来|佩戴不牢固|扣环扣不紧|项圈松紧)/],
    examples: ["项圈扣环扣不紧怎么办", "项圈掉下来", "佩戴不牢固", "项圈松紧要怎么调"],
    queryHints: ["项圈容易脱落、不够紧怎么办？"],
    priorityFaqIds: ["F860-003"],
  },
  {
    name: "effect_decay",
    patterns: [/(初期有效后续不起作用|用久了没效果|用了几天后效果越来越差|刚开始有用后来没用|越来越不灵|后面没效果)/],
    examples: ["设备最近感觉越来越不灵了", "刚开始有用后来没用", "用了几天后效果越来越差", "用久了没效果"],
    queryHints: ["初期有效后续不起作用怎么办？", "产品未改变狗狗行为怎么办？"],
    priorityFaqIds: ["F860-004", "F860-007"],
  },
  {
    name: "button_issue",
    patterns: [/(按了没反应|按键按不动|按键按下去弹不起来|按键会自己误触发|按键失灵|按键卡键|按钮没反应)/],
    examples: ["按了没反应", "按键按不动", "按键弹不起来", "按键会自己误触发"],
    queryHints: ["按键卡键/不灵敏/重按/松动/失灵"],
    priorityFaqIds: ["F860-010"],
  },
  {
    name: "applicable_dogs",
    patterns: [/(攻击性狗狗可以用吗|颈围要求是多少|多大的狗能用|小型犬能用吗|适合什么狗狗用|什么犬种能用)/],
    examples: ["攻击性狗狗可以用吗？", "颈围要求是多少？", "多大的狗能用？", "小型犬能用吗？"],
    queryHints: ["产品适用哪些犬类？"],
    priorityFaqIds: ["F860-012"],
  },
  {
    name: "first_use_guidance",
    patterns: [/(首次使用需要注意什么|第一次使用前怎么测试设备是否正常|第一次用前要注意什么|刚开始用要注意什么)/],
    examples: ["首次使用需要注意什么？", "第一次使用前怎么测试设备是否正常", "刚开始用要注意什么"],
    queryHints: ["产品的使用场景有哪些要求？", "如何连接接收器？"],
    priorityFaqIds: ["F860-013", "F860-028"],
  },
  {
    name: "work_modes",
    patterns: [/(有几种工作模式|一共有哪几种模式|围栏模式和训狗模式怎么切换|模式可以调节吗|工作模式有哪些)/],
    examples: ["这个设备一共有哪几种模式", "有几种工作模式？", "围栏模式和训狗模式怎么切换"],
    queryHints: ["产品有哪些工作模式？"],
    priorityFaqIds: ["F860-016"],
  },
  {
    name: "product_durability",
    patterns: [/(很容易坏|使用寿命短|经常出故障|一进水就容易坏|耐用性差|不耐用)/],
    examples: ["这个设备是不是很容易坏", "使用寿命短", "设备是不是经常出故障", "是不是一进水就容易坏"],
    queryHints: ["产品耐用性差，使用时间短容易损坏？", "如何正确清洁和维护设备"],
    priorityFaqIds: ["F860-018", "F860-045"],
  },
  {
    name: "strap_break_issue",
    patterns: [/(狗带不结实|狗带突然断裂|狗带耳朵裂了|狗带扣子坏了|狗带断了)/],
    examples: ["狗带不结实", "狗带突然断裂了怎么办", "狗带耳朵裂了", "狗带扣子坏了怎么办"],
    queryHints: ["接收器狗带耳朵断裂"],
    priorityFaqIds: ["F860-019"],
  },
  {
    name: "stimulation_safety",
    patterns: [/(刺激安全吗|电击有害吗|振动会伤到狗狗吗|符合安全标准吗|可以长时间用吗|能一直用吗)/],
    examples: ["可以长时间用吗？", "刺激安全吗？", "电击对狗狗有害吗？", "振动会伤到狗狗吗？"],
    queryHints: ["振动/静态刺激是否安全？"],
    priorityFaqIds: ["F860-005"],
  },
  {
    name: "pet_injury_issue",
    patterns: [/(设备伤到狗狗了怎么办|狗狗被设备弄伤|颈部红肿|磨破了|皮肤起疹子|佩戴后不舒服)/],
    examples: ["设备伤到狗狗了怎么办？", "狗狗被设备弄伤", "项圈把狗狗皮肤磨破了", "戴了项圈后皮肤起疹子"],
    queryHints: ["设备伤到狗狗了怎么办？", "宠物会对项圈过敏、磨皮肤吗？"],
    priorityFaqIds: ["F860-006", "F860-009"],
  },
  {
    name: "positioning_boundary",
    patterns: [/(定位刷新|边界判断|边界判定|判定能力|误报|漏报|乱报|边界准不准|触发准吗|会不会乱叫|信号异常时围栏还能用吗)/],
    examples: ["围栏准不准？", "边界判断准吗？", "会不会误报漏报？", "会不会乱报", "会不会误判"],
    queryHints: [
      "围栏是否始终准确触发？",
      "围栏触发延迟是正常吗？",
      "当设备显示信号异常时，我还能使用围栏吗？",
    ],
    priorityFaqIds: ["F860-034", "F860-033", "F860-036", "F860-002", "F860-040"],
  },
  {
    name: "waterproof_durability",
    patterns: [/(防水|防尘|雨天|下雨|淋雨|海边|沙滩|户外防护|ip67|耐候)/i],
    examples: ["下雨能用吗？", "淋雨会坏吗？", "防水怎么样？", "耐用吗？"],
    queryHints: ["产品耐用性差，使用时间短容易损坏？", "如何正确清洁和维护设备"],
    priorityFaqIds: ["F860-018", "F860-045"],
  },
  {
    name: "usage_scenarios",
    patterns: [/(适用场景|适合.*场景|哪些场景|什么场景|什么环境|哪里可以用|哪里能用|什么地方能用|哪里使用合适|在哪使用合适|室内室外|哪种环境能用|什么地方适合用|农场|牧场|露营|庭院|郊区住宅|首次使用|第一次使用前|怎么测试设备是否正常)/],
    examples: ["在哪里可以用？", "什么地方能用？", "哪里使用合适？", "室内室外都能用吗？", "哪种环境能用？", "第一次使用前怎么测试设备是否正常"],
    queryHints: ["产品的使用场景有哪些要求？", "产品适合室内使用吗？", "产品适用哪些犬类？"],
    priorityFaqIds: ["F860-013", "F860-015", "F860-012"],
  },
  {
    name: "material_cleaning",
    patterns: [/(材质|清洁|清洗|好洗|耐用|项圈材料|维护)/],
    examples: ["怎么清洁？", "平时怎么保养？", "项圈材质安全吗？", "怎么维护设备？"],
    queryHints: ["如何正确清洁和维护设备", "宠物会对项圈过敏、磨皮肤吗？"],
    priorityFaqIds: ["F860-045", "F860-009"],
  },
  {
    name: "training_effectiveness",
    patterns: [/(没效果|不见效|不管用|效果不好|行为没改善|还是越界|训练了.*没用|为啥没反应|为什么没反应|没啥反应|怎么训练才有效)/],
    examples: ["没效果怎么办", "为什么没效果？", "训练了还是没用", "还是越界怎么办？", "不管用怎么办", "为啥没反应", "怎么训练才有效"],
    queryHints: ["产品未改变狗狗行为怎么办？", "狗狗需要接受专门训练才能使用围栏吗"],
    priorityFaqIds: ["F860-007", "F860-044"],
  },
  {
    name: "charging_issue",
    patterns: [/(充不上电|充不进电|充不了电|充电没反应|充电失败|充不满|充电很慢|充电太慢|充不上|没法充电)/],
    examples: ["充不上电", "充电没反应", "为什么充不进去", "充很久都不满", "充电特别慢怎么办"],
    queryHints: ["设备无法充电怎么办？", "充电时间过长/充不满", "产品长时间未使用后如何处理？"],
    priorityFaqIds: ["F860-020", "F860-021", "F860-023"],
  },
  {
    name: "startup_issue",
    patterns: [/(开不了机|无法启动|启动不了|打不开|不工作了|没法用了|没反应了|开不了|启动失败|完全没反应)/],
    examples: ["开不了咋办", "开不了机怎么办", "设备不工作了", "没法用了怎么办", "启动不了"],
    queryHints: ["产品无法启动怎么办？", "产品无法正常使用怎么办？", "设备突然不工作了怎么办？"],
    priorityFaqIds: ["F860-027", "F860-039", "F860-024"],
  },
  {
    name: "gps_signal_issue",
    patterns: [/(搜不到gps|gps没信号|信号突然消失|定位不上|没搜到信号|搜星失败|定位不到|没有gps|没信号怎么办)/i],
    examples: ["搜不到GPS怎么办", "GPS没信号", "设备使用中突然信号丢失", "设备定位不上怎么办"],
    queryHints: ["无法搜索到GPS信号或丢失信号怎么办？", "当设备显示信号异常时，我还能使用围栏吗？"],
    priorityFaqIds: ["F860-001", "F860-036"],
  },
  {
    name: "battery_endurance",
    patterns: [/(一天用不到就关机|续航这么短|电量掉得特别快|充一次用不久|低温续航差|不耐用|掉电太快|一天就没电|耗电快|续航短)/],
    examples: ["为什么一天就没电了", "设备电量掉得特别快", "充一次用不久", "低温续航差"],
    queryHints: ["电池不耐用、一天用不到就关机了？", "产品长时间未使用后如何处理？", "充电时间过长/充不满"],
    priorityFaqIds: ["F860-022", "F860-023", "F860-021"],
  },
  {
    name: "fence_page_load_issue",
    patterns: [/(围栏页面一直转圈|连接加载失败|围栏界面连不上|进入围栏界面总提示连接失败|围栏页加载不出来|一直正在连接)/],
    examples: ["围栏页面一直转圈怎么办", "围栏界面连接加载失败", "进入围栏界面总提示连接失败", "界面一直加载不出来"],
    queryHints: ["围栏界面连接加载失败怎么处理？", "如何连接接收器？"],
    priorityFaqIds: ["F860-029", "F860-028"],
  },
  {
    name: "fence_alert_setup",
    patterns: [/(怎么开启电子围栏告警|怎么开启围栏告警|如何开启电子围栏告警|如何开启围栏告警|怎么设置电子围栏告警|怎么设置围栏告警|怎么启用电子围栏报警|怎么启用围栏报警|开启围栏提醒|启用围栏提醒)/],
    examples: ["怎么开启电子围栏告警？", "如何开启围栏告警", "怎么设置围栏报警", "怎么启用电子围栏提醒"],
    queryHints: ["如何连接接收器？"],
    priorityFaqIds: ["F860-028"],
  },
  {
    name: "fence_no_alarm",
    patterns: [/(围栏明明开着却不报警|越界后不报警|报警功能不生效|出界后不工作|围栏已启用但未触发报警|开着却没反应)/],
    examples: ["围栏明明开着却不报警", "越界后不报警", "报警功能不生效怎么办", "出界后不工作怎么办"],
    queryHints: ["围栏已启用，但未触发报警，该怎么办？", "预警/纠正功能没反应", "产品功能未被激活怎么办？"],
    priorityFaqIds: ["F860-032", "F860-026", "F860-042"],
  },
  {
    name: "small_fence_issue",
    patterns: [/(围栏画得太小会不会更容易触发|围栏画小一点会不会更准|把围栏缩小后效果会更好吗|小范围围栏效果更好吗|围栏画小一点好吗)/],
    examples: ["把围栏画小一点会不会更准", "围栏画得太小会不会更容易触发", "把围栏缩小后效果会更好吗"],
    queryHints: ["绘制小范围围栏，围栏效果是否会更好？", "围栏是否始终准确触发？"],
    priorityFaqIds: ["F860-035", "F860-034"],
  },
  {
    name: "fence_disabled_effect",
    patterns: [/(关闭围栏后进出还会工作吗|把围栏关掉后报警还会不会触发|关闭围栏以后设备还会自动纠正吗|关掉围栏后会怎样|关闭围栏会发生什么)/],
    examples: ["把围栏关掉后报警还会不会触发", "关闭围栏后进出还会工作吗", "关闭围栏以后设备还会自动纠正吗"],
    queryHints: ["关闭围栏后会发生什么？"],
    priorityFaqIds: ["F860-038"],
  },
  {
    name: "startup_beep_issue",
    patterns: [/(开机一直响|开机有提示音|开启后一直响|开机响3分钟|提示音不停|gps图标闪烁一直叫)/i],
    examples: ["开机一直响", "开机有提示音", "开机响3分钟", "提示音不停"],
    queryHints: ["机器开启时响起声音怎么办？", "无法搜索到GPS信号或丢失信号怎么办？"],
    priorityFaqIds: ["F860-041", "F860-001"],
  },
  {
    name: "feature_not_activated",
    patterns: [/(功能没激活|宠物出界不惩罚|越界没反应|功能一直激活失败|出界后设备怎么一点动作都没有|没动作都没有)/],
    examples: ["宠物出界后设备怎么一点动作都没有", "功能没激活", "宠物出界不惩罚", "越界没反应"],
    queryHints: ["产品功能未被激活怎么办？", "围栏已启用，但未触发报警，该怎么办？"],
    priorityFaqIds: ["F860-042", "F860-032"],
  },
  {
    name: "accessory_damage_issue",
    patterns: [/(收到货发现少了配件|配件损坏了该怎么处理|收到货配件缺失|运输途中损坏了怎么办|少了配件怎么办|配件坏了怎么办)/],
    examples: ["收到货发现少了配件怎么办", "配件损坏了该怎么处理", "收到货配件缺失", "运输途中损坏了怎么办"],
    queryHints: ["缺少配件、配件损坏怎么办？"],
    priorityFaqIds: ["F860-043"],
  },
  {
    name: "stimulation_output_issue",
    patterns: [/(震动没反应|电击没效果|静音功能失效|静态刺激无效|无震动|无静音|刺激强度不够|一点反应都没有)/],
    examples: ["震动没反应怎么办", "电击没效果", "静音功能失效", "静态刺激无效怎么办"],
    queryHints: ["无静音/无震动/静态刺激无效怎么办？", "预警/纠正功能没反应"],
    priorityFaqIds: ["F860-025", "F860-026"],
  },
  {
    name: "multiple_fences",
    patterns: [/(多个围栏|好几个围栏|一次性建多个围栏|同时创建多个围栏|一次设置多个围栏)/],
    examples: ["能不能一次性建多个围栏", "支持同时添加好几个围栏吗", "能不能一次设置多个围栏"],
    queryHints: ["是否可以同时创建多个围栏？", "围栏创建后可以修改吗？"],
    priorityFaqIds: ["F860-030", "F860-031"],
  },
  {
    name: "edit_fence",
    patterns: [/(修改围栏|编辑围栏|调整围栏范围|围栏创建后可以修改吗|怎么调整围栏|围栏怎么编辑)/],
    examples: ["围栏怎么编辑", "如何修改围栏", "怎么调整围栏范围", "围栏创建后可以修改吗"],
    queryHints: ["围栏创建后可以修改吗？", "是否可以同时创建多个围栏？"],
    priorityFaqIds: ["F860-031", "F860-030"],
  },
  {
    name: "fence_trigger_delay",
    patterns: [/(触发有点慢|围栏报警有延迟|为什么出界后不是立刻触发|触发延迟正常吗|不是立刻触发|延迟正常吗)/],
    examples: ["为什么出界后不是立刻触发", "围栏报警有延迟正常吗", "触发围栏有点慢，是不是正常的"],
    queryHints: ["围栏触发延迟是正常吗？", "围栏是否始终准确触发？"],
    priorityFaqIds: ["F860-033", "F860-034"],
  },
  {
    name: "fence_creation_without_wear",
    patterns: [/(创建围栏时.*佩戴|先不戴在狗身上能不能创建围栏|画围栏的时候设备一定要先戴上吗|不佩戴设备能不能先设置好围栏)/],
    examples: ["画围栏的时候设备一定要先戴上吗", "先不戴在狗身上能不能创建围栏", "创建围栏时宠物需要佩戴着设备吗"],
    queryHints: ["创建围栏时，设备是否需要宠物佩戴？", "如何连接接收器？"],
    priorityFaqIds: ["F860-037", "F860-028"],
  },
  {
    name: "alarm_without_penalty",
    patterns: [/(只报警不惩罚|超出范围没反应|误报超出距离|警报后无动作|显示超出安全距离但未受到处罚|只报警没处罚)/],
    examples: ["只报警不惩罚怎么办", "超出范围没反应", "警报后无动作", "显示超出安全距离但未受到处罚怎么办"],
    queryHints: ["显示超出安全距离但未受到处罚怎么办？", "围栏是否始终准确触发？"],
    priorityFaqIds: ["F860-040", "F860-034"],
  },
  {
    name: "indoor_usage_limit",
    patterns: [/(室内能用吗|在家里室内能直接用围栏吗|室内信号不好还能用这个产品吗|适合室内使用吗|家里能用吗)/],
    examples: ["在家里室内能直接用围栏吗", "室内能用吗", "室内信号不好还能用这个产品吗", "适合室内使用吗"],
    queryHints: ["产品适合室内使用吗？", "产品的使用场景有哪些要求？"],
    priorityFaqIds: ["F860-015", "F860-013"],
  },
  {
    name: "product_advantages",
    patterns: [/(优势|亮点|卖点|好处|核心价值|为什么选|特点|优点)/],
    examples: ["产品优势是什么？", "这个产品有什么亮点？", "有什么特殊功能？", "为什么选它？"],
    queryHints: [
      "产品有哪些核心特点？",
      "产品是什么，能解决什么问题？",
      "设备可以创建那些类型的围栏？",
      "狗狗需要接受专门训练才能使用围栏吗",
    ],
    priorityFaqIds: ["F860-014", "F860-011", "F860-017", "F860-044"],
  },
  {
    name: "product_usage",
    patterns: [
      /(怎么用|怎么使用|如何使用|使用方法|使用步骤|使用教程|上手指南|怎么上手|新手|第一次用|第一次咋弄|如何设置|怎么设置|如何操作|操作流程|怎么连上|连上手机|连上app|连接手机|怎么配对|怎么连接)/,
    ],
    examples: ["怎么设置电子围栏？", "第一次怎么用？", "接收器怎么连？", "这个产品怎么用？", "第一次咋弄", "怎么连上手机"],
    queryHints: [
      "如何连接接收器？",
      "设备可以创建那些类型的围栏？",
      "是否可以同时创建多个围栏？",
      "围栏创建后可以修改吗？",
      "创建围栏时，设备是否需要宠物佩戴？",
    ],
    priorityFaqIds: ["F860-028", "F860-017", "F860-030", "F860-031", "F860-037", "F860-044"],
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

  let bestProfile = null;
  let bestScore = 0;
  for (const profile of queryIntentProfiles) {
    const examples = Array.isArray(profile.examples) ? profile.examples : [];
    for (const example of examples) {
      const score = computeIntentExampleScore(normalized, example);
      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }
  }

  return bestScore >= 0.45 ? bestProfile : null;
}

function resolveQueryIntent(text, availableFaqIds = null) {
  const profile = detectQueryIntent(text);
  if (!profile) return null;
  if (!(availableFaqIds instanceof Set) || !availableFaqIds.size) {
    return profile;
  }

  const matchedFaqIds = (profile.priorityFaqIds || []).filter((faqId) =>
    availableFaqIds.has(faqId),
  );
  if (!matchedFaqIds.length) {
    return null;
  }

  return {
    ...profile,
    priorityFaqIds: matchedFaqIds,
  };
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

function buildQueryPlan(query, intent = null) {
  const normalizedQuery = normalizeTerminology(query);
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

function isGreetingMessage(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[？?！!，,。.、~\s]/g, "");
  if (!normalized) return false;

  return [
    "你好",
    "您好",
    "哈喽",
    "嗨",
    "hi",
    "hello",
  ].includes(normalized);
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

function extractTopicText(text) {
  return normalizeTerminology(text)
    .toLowerCase()
    .replace(/f860/g, "")
    .replace(/电子围栏/g, "")
    .replace(/gps/g, "")
    .replace(/app/g, "")
    .replace(/产品|设备|项圈|宠物|狗狗/g, "")
    .replace(/需要|需不需要|要不要|要吗|是否|能否|可以|可否|是不是|有没有/g, "")
    .replace(/请问|一下|这个|这款|这台|怎么|如何|吗|呢|呀|啊/g, "")
    .replace(/\s+/g, "");
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

function computeTopicLexicalMatch(query, candidateText) {
  return computeLexicalMatch(
    extractTopicText(query),
    extractTopicText(candidateText),
  );
}

function normalizeIntentText(text) {
  return normalizeTerminology(text)
    .toLowerCase()
    .replace(/f860/g, "")
    .replace(/电子围栏/g, "")
    .replace(/gps/g, "")
    .replace(/app/g, "")
    .replace(/产品|设备|项圈|宠物|狗狗/g, "")
    .replace(/请问|一下|这个|这款|这台/g, "")
    .replace(/[？?！!，。,、\s]/g, "");
}

function computeIntentExampleScore(query, example) {
  const normalizedQuery = normalizeIntentText(query);
  const normalizedExample = normalizeIntentText(example);
  if (!normalizedQuery || !normalizedExample) return 0;
  if (
    normalizedQuery.includes(normalizedExample) ||
    normalizedExample.includes(normalizedQuery)
  ) {
    return 1;
  }
  return computeLexicalMatch(normalizedQuery, normalizedExample);
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

async function getKnowledgeBaseFaqIds() {
  const index = await ensureBm25Index();
  return new Set(index.docs.map((doc) => String(doc.payload?.faq_id || "")).filter(Boolean));
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
  return rerankSearchHits(query, denseHits, bm25Hits, limit, {
    hybridRrfK,
    rerankWeightDense,
    rerankWeightBm25,
    rerankWeightLexical,
  });
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

  const availableFaqIds = await getKnowledgeBaseFaqIds();
  const plan = buildQueryPlan(
    query,
    resolveQueryIntent(query, availableFaqIds),
  );
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

function buildFallbackReply(hits) {
  const trusted = hits.filter((hit) => hit.score >= ragScoreThreshold);
  const best = trusted[0] || hits[0];

  if (!best) {
    return genericFallbackReply;
  }

  const answer = best.payload?.answer;
  if (!answer) {
    return genericFallbackReply;
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
    anti_loss_reliability: "F860-008",
    false_alarm_in_safe_zone: "F860-002",
    collar_fit_issue: "F860-003",
    effect_decay: "F860-004",
    button_issue: "F860-010",
    applicable_dogs: "F860-012",
    first_use_guidance: "F860-013",
    work_modes: "F860-016",
    product_durability: "F860-018",
    strap_break_issue: "F860-019",
    stimulation_safety: "F860-005",
    pet_injury_issue: "F860-006",
    waterproof_durability: "F860-018",
    usage_scenarios: "F860-013",
    material_cleaning: "F860-045",
    positioning_boundary: "F860-034",
    training_effectiveness: "F860-007",
    charging_issue: "F860-020",
    startup_issue: "F860-027",
    gps_signal_issue: "F860-001",
    battery_endurance: "F860-022",
    fence_page_load_issue: "F860-029",
    fence_no_alarm: "F860-032",
    small_fence_issue: "F860-035",
    fence_disabled_effect: "F860-038",
    startup_beep_issue: "F860-041",
    feature_not_activated: "F860-042",
    accessory_damage_issue: "F860-043",
    stimulation_output_issue: "F860-025",
    multiple_fences: "F860-030",
    edit_fence: "F860-031",
    fence_trigger_delay: "F860-033",
    fence_creation_without_wear: "F860-037",
    alarm_without_penalty: "F860-040",
    indoor_usage_limit: "F860-015",
  };
  const canonicalFaqId = canonicalByIntent[intentName];
  if (canonicalFaqId) {
    const canonical = pickAnswerByFaq(hits, canonicalFaqId);
    if (canonical) return canonical;
  }

  if (intentName === "product_advantages") {
    const canonical = pickAnswerByFaq(hits, "F860-014");
    if (canonical) return canonical;
    const a1 = pickAnswerByFaq(hits, "F860-011");
    const a2 = pickAnswerByFaq(hits, "F860-017");
    const a3 = pickAnswerByFaq(hits, "F860-044");
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
    const canonical = pickAnswerByFaq(hits, "F860-028");
    if (canonical) return canonical;
    const step1 = pickAnswerByFaq(hits, "F860-017");
    const step2 = pickAnswerByFaq(hits, "F860-030");
    const step3 = pickAnswerByFaq(hits, "F860-031");
    const fallback = pickTopAnswers(hits, 3);
    const steps = [step1, step2, step3].filter(Boolean);
    const list = (steps.length >= 2 ? steps : fallback).slice(0, 3);
    if (!list.length) return "";
    return [
      "你可以按下面步骤上手 F860：",
      ...list.map((item, idx) => `${idx + 1}. ${item}`),
    ].join("\n");
  }

  return "";
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ai-cs-service",
    qdrantConfigured: Boolean(qdrantUrl),
    embeddingConfigured: Boolean(embeddingBaseUrl && embeddingModel),
    ragCollection: qdrantCollection,
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

  try {
    if (isGreetingMessage(message)) {
      const now = new Date().toISOString();
      const reply = greetingReply;

      await appendJsonArray("messages.json", {
        timestamp: now,
        userId,
        sessionId,
        message,
        reply,
        appContext,
        retrieval: {
          error: "",
          topScore: 0,
          topDenseScore: 0,
          lexicalMatch: 0,
          topicLexicalMatch: 0,
          lexicalMatchMin,
          semanticMatchMinDense,
          intent: "",
          answerConfidenceThreshold,
          topHits: [],
        },
      });

      return res.json({
        sessionId,
        reply,
        sources: [],
        timestamp: now,
      });
    }

    let retrievalError = "";
    let hits = [];
    const normalizedMessage = normalizeTerminology(message);
    const availableFaqIds = await getKnowledgeBaseFaqIds();
    const queryIntent = resolveQueryIntent(normalizedMessage, availableFaqIds);
    try {
      hits = await searchKnowledgeBase(message);
    } catch (err) {
      retrievalError = err?.message || "retrieval_unknown_error";
      console.error("retrieval_failed", err);
    }

    const presetReply = buildIntentPresetReply(queryIntent?.name || "", hits);
    let reply = presetReply || buildFallbackReply(hits);

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
    const topicLexicalMatch = computeTopicLexicalMatch(
      normalizedMessage,
      normalizedTopCandidateText,
    );
    const effectiveLexicalMatch = queryIntent ? lexicalMatch : topicLexicalMatch;

    const hasTopAnswer = Boolean(String(topPayload.answer || "").trim());
    const decisionQuestion = isDecisionQuestion(message);
    const unsupportedTopic = isLikelyUnsupportedTopic(message) && !queryIntent;
    const lowConfidenceNoIntent =
      !queryIntent &&
      topScore <= unknownTopicScoreMax &&
      topDenseScore <= unknownTopicDenseMax &&
      effectiveLexicalMatch <= unknownTopicLexicalMax;
    const shouldReturnUnknown = unsupportedTopic || lowConfidenceNoIntent;
    const semanticMatched =
      (topDenseScore >= semanticMatchMinDense || topScore >= directAnswerMinScore) &&
      (Boolean(queryIntent) || effectiveLexicalMatch >= semanticLexicalFloor);
    const intentDrivenAnswer =
      Boolean(queryIntent) &&
      topScore >= intentAnswerMinScore &&
      topDenseScore >= semanticMatchMinDense * 0.9;
    const noIntentDirectAnswer =
      !queryIntent &&
      ((topScore >= answerConfidenceThreshold &&
        effectiveLexicalMatch >= lexicalMatchMin) ||
        (topScore >= directAnswerMinScore &&
          effectiveLexicalMatch >= Math.max(lexicalMatchMin, 0.3)) ||
        (decisionQuestion &&
          topScore >= decisionQuestionMinScore &&
          effectiveLexicalMatch >= decisionQuestionLexicalMin));
    const shouldPreferDirectAnswer =
      !shouldReturnUnknown &&
      hasTopAnswer &&
      (intentDrivenAnswer ||
        (Boolean(queryIntent) &&
          (topScore >= answerConfidenceThreshold ||
            (topDenseScore >= semanticMatchMinDense &&
              topScore >= intentAnswerMinScore) ||
            (topScore >= directAnswerMinScore &&
              effectiveLexicalMatch >= lexicalMatchMin) ||
            (decisionQuestion &&
              topScore >= decisionQuestionMinScore &&
              effectiveLexicalMatch >= decisionQuestionLexicalMin))) ||
        noIntentDirectAnswer);
    const shouldUseFallback = shouldReturnUnknown || !shouldPreferDirectAnswer;

    if (shouldUseFallback) {
      reply = genericFallbackReply;
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
        lexicalMatch: Number(effectiveLexicalMatch.toFixed(4)),
        topicLexicalMatch: Number(topicLexicalMatch.toFixed(4)),
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

app.listen(port, () => {
  console.log(`AI CS service running on http://localhost:${port}`);
});
