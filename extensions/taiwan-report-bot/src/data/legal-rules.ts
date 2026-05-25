import type { LegalCitation, ViolationCategory } from "../types.js";

interface RuleEntry {
  pattern: RegExp;
  citation: LegalCitation;
}

/**
 * ============================================================================
 * 交通違規 — 規則目錄
 * ============================================================================
 *
 * 本目錄依《道路交通管理處罰條例》整理。每條規則標註：
 *   • reportableByCitizen — 是否屬 §7-1 民眾可檢舉之違規（2022 修法後現行版本）
 *   • policeInitiated     — 是否屬 §7-2 警察可逕行舉發之違規
 *   • evidenceMode        — 採證要件（instantaneous / continuous / moving）
 *
 * §7-1 民眾檢舉之主要範圍（本目錄已涵蓋）：
 *   違規停車（紅線/黃線/人行道/騎樓/消防/公車站/身障車位/機車格/並排）
 *   闖紅燈、紅燈右轉、逆向行駛、蛇行、違規超車、違規迴轉
 *   未禮讓行人、機車行駛人行道、駕駛吸菸丟菸蒂
 *
 * 不可由民眾檢舉之違規（限警察執行；本目錄列出以利使用者誤舉時提示）：
 *   超速、未戴安全帽、未繫安全帶、酒駕、未保持安全距離、不依規定變換車道
 */
const trafficRules: RuleEntry[] = [
  // ============ 違規停車：禁止臨停場所（單張即可） ============
  {
    pattern: /(紅線|禁止臨時停車)/,
    citation: {
      shortLabel: "違規停車（紅線）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 1 款",
      penalty: "在禁止臨時停車處所停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(人行道.*停|停.*人行道|佔用人行道|占用人行道)/,
    citation: {
      shortLabel: "違規停車（人行道）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 4 款",
      penalty: "在人行道、行人穿越道、快車道、安全島、雙黃線、消防車出入口、消防栓、消防通道五公尺內或公共設施旁停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(騎樓.*停|停.*騎樓|佔用騎樓|占用騎樓)/,
    citation: {
      shortLabel: "違規停車（騎樓）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 4 款",
      penalty: "在人行道（含騎樓）停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(消防栓|消防車出入口|消防通道)/,
    citation: {
      shortLabel: "違規停車（消防設施 5 m 內）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 4 款",
      penalty: "在消防車出入口、消防栓、消防通道五公尺內停車。處 600–1,200 元罰鍰；情節重大涉公共危險者可依消防法處理。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(公車站|計程車招呼站|招呼站)/,
    citation: {
      shortLabel: "違規停車（公車/計程車招呼站）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 4 款",
      penalty: "於公共汽車招呼站、計程車招呼站十公尺內停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(身心障礙.*車位|身障.*車位|無障礙.*車位)/,
    citation: {
      shortLabel: "佔用身心障礙專用車位",
      statute: "身心障礙者權益保障法",
      article: "第 56 條 第 4 項（並依道交條例第 56 條第 1 項第 7 款）",
      penalty: "非身心障礙者違規占用身心障礙者專用停車位。處 1,200–3,600 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(汽車.*機車格|機車格.*汽車|占用機車格|佔用機車格)/,
    citation: {
      shortLabel: "汽車佔用機車停車格",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 6 款",
      penalty: "於標有禁止停車線、標字之處所停車（含汽車占用機車格）。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },

  // ============ 違規停車：禁止停車場所（需 2 張 + 3 分鐘） ============
  {
    pattern: /(黃線|禁止停車)/,
    citation: {
      shortLabel: "違規停車（黃線）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 2 款",
      penalty: "在禁止停車處所停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "continuous",
    },
  },
  {
    pattern: /(計時收費.*停車|未繳停車費|停車格.*未繳費|逾時停車)/,
    citation: {
      shortLabel: "道路收費停車未繳費",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 2 項",
      penalty: "在道路收費停車處所停車，不依規定繳費。處 300 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "continuous",
    },
  },
  {
    pattern: /(並排停車|併排停車|併排|並排)/,
    citation: {
      shortLabel: "並排停車",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 5 款",
      penalty: "並排停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "continuous",
    },
  },

  // ============ 動態違規（民眾可檢舉，需錄影或連續證據） ============
  {
    pattern: /(闖紅燈|搶紅燈)/,
    citation: {
      shortLabel: "闖紅燈",
      statute: "道路交通管理處罰條例",
      article: "第 53 條 第 1 項",
      penalty: "汽車駕駛人，行經有燈光號誌管制之交岔路口闖紅燈。處 1,800–5,400 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /紅燈右轉/,
    citation: {
      shortLabel: "紅燈右轉",
      statute: "道路交通管理處罰條例",
      article: "第 53 條 第 2 項",
      penalty: "支線道車輛駕駛人停車再開後逕行紅燈右轉。處 600–1,800 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(逆向|逆行|不按遵行|單行道.*錯誤方向)/,
    citation: {
      shortLabel: "逆向行駛 / 不按遵行方向",
      statute: "道路交通管理處罰條例",
      article: "第 45 條 第 1 項 第 6 款",
      penalty: "不按遵行之方向行駛。處 600–1,800 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(蛇行|危險駕駛|危險方式駕車|危險變換車道)/,
    citation: {
      shortLabel: "危險駕駛 / 蛇行",
      statute: "道路交通管理處罰條例",
      article: "第 43 條 第 1 項 第 1 款",
      penalty: "在道路上蛇行或以其他危險方式駕車。處 6,000–24,000 元罰鍰、吊扣駕照 1 年，並當場移置保管車輛。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(違規超車|不當超車)/,
    citation: {
      shortLabel: "違規超車",
      statute: "道路交通管理處罰條例",
      article: "第 47 條",
      penalty: "違反禁止超車之規定。處 1,200–3,600 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(違規迴轉|不當迴轉|禁止迴轉|違規迴車)/,
    citation: {
      shortLabel: "違規迴轉",
      statute: "道路交通管理處罰條例",
      article: "第 49 條",
      penalty: "違反禁止迴轉之規定。處 600–1,800 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(未禮讓行人|不禮讓行人|未讓行人|行人.*穿越.*未讓)/,
    citation: {
      shortLabel: "未禮讓行人",
      statute: "道路交通管理處罰條例",
      article: "第 44 條 第 2 項",
      penalty: "行近劃有標線之行人穿越道，不依規定讓行人優先通行。處 6,000 元罰鍰，並施以道安講習；致人死傷者另加重處罰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(機車.*行駛人行道|機車行駛人行道)/,
    citation: {
      shortLabel: "機車行駛人行道",
      statute: "道路交通管理處罰條例",
      article: "第 74 條 第 1 項 第 3 款",
      penalty: "機器腳踏車不依規定使用車道（行駛人行道）。處 600–1,800 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(吸菸.*菸蒂|亂丟菸蒂|丟棄菸蒂|車內吸菸)/,
    citation: {
      shortLabel: "駕駛行駛中吸菸 / 丟菸蒂",
      statute: "道路交通管理處罰條例",
      article: "第 31 條 第 5 項",
      penalty: "駕駛或乘坐汽車於行駛中吸菸，致菸灰、菸蒂飛散。處 600 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },

  // ============ 限警察執行：列入以利提示使用者「不可民眾檢舉」 ============
  {
    pattern: /(超速|時速.*超過|超過速限)/,
    citation: {
      shortLabel: "超速（限警察測速）",
      statute: "道路交通管理處罰條例",
      article: "第 40 條",
      penalty: "行車速度超過規定之最高時速。處 1,200–24,000 元罰鍰（依超速程度）。",
      reportableByCitizen: false,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(未戴安全帽|無安全帽)/,
    citation: {
      shortLabel: "機車未戴安全帽（限警察）",
      statute: "道路交通管理處罰條例",
      article: "第 31 條 第 6 項",
      penalty: "機車駕駛人或附載坐人未依規定戴安全帽。處 500 元罰鍰。",
      reportableByCitizen: false,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(未繫安全帶|無安全帶)/,
    citation: {
      shortLabel: "未繫安全帶（限警察）",
      statute: "道路交通管理處罰條例",
      article: "第 31 條 第 1 項",
      penalty: "未依規定使用安全帶。處 1,500 元罰鍰（高速公路 3,000–6,000 元）。",
      reportableByCitizen: false,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(酒駕|酒後駕車|酒測|酒精濃度)/,
    citation: {
      shortLabel: "酒後駕車（限警察攔檢）",
      statute: "道路交通管理處罰條例",
      article: "第 35 條",
      penalty: "酒精濃度超過規定標準。處 30,000–120,000 元罰鍰，吊扣或吊銷駕照、移置保管車輛；達公共危險罪標準者移送刑事偵辦（刑法 §185-3）。",
      reportableByCitizen: false,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },
  {
    pattern: /(未保持安全距離|安全距離不足)/,
    citation: {
      shortLabel: "未保持安全距離（限警察）",
      statute: "道路交通管理處罰條例",
      article: "第 62 條 第 1 項",
      penalty: "未保持安全距離。處 600–1,200 元罰鍰。",
      reportableByCitizen: false,
      policeInitiated: true,
      evidenceMode: "moving",
    },
  },

  // ============ 兜底：場所未指明的「違停」— 保守預設為 continuous ============
  {
    pattern: /(違停|違規停車)/,
    citation: {
      shortLabel: "違規停車（場所未明）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條（適用款項依現場標線/標誌）",
      penalty: "違規停車。處 600–1,200 元罰鍰（依場所類別適用第 56 條各款）。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "continuous",
    },
  },
];

// ============================================================================
// 環保違規
// ============================================================================
const environmentRules: RuleEntry[] = [
  {
    pattern: /(亂丟垃圾|棄置垃圾|隨意拋|果皮|塑膠袋丟)/,
    citation: {
      shortLabel: "亂丟垃圾",
      statute: "廢棄物清理法",
      article: "第 27 條 / 第 50 條",
      penalty: "在指定清除地區內，不得任意棄置垃圾。違者處 1,200–6,000 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      reward: {
        available: true,
        authority: "各縣市環境保護局",
        basis: "違反廢棄物清理法案件民眾檢舉獎金支給辦法",
        rewardType: "percentage_of_fine",
        estimateRange: "罰鍰之 30%–50%（約 360–3,000 元）",
        notes: "需查獲屬實並完成裁罰後核發",
      },
    },
  },
  {
    pattern: /(廢棄物|傾倒|爐渣|事業廢棄物|有害廢棄物)/,
    citation: {
      shortLabel: "棄置有害事業廢棄物",
      statute: "廢棄物清理法",
      article: "第 46 條",
      penalty: "任意棄置有害事業廢棄物。處 1 年以上 5 年以下有期徒刑，得併科 1,500 萬元以下罰金。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      reward: {
        available: true,
        authority: "環境部 / 各縣市環境保護局",
        basis: "違反廢棄物清理法案件民眾檢舉獎金支給辦法 §3",
        rewardType: "tiered",
        estimateRange: "重大案件最高 50 萬元（依罰鍰級距）",
        notes: "依查獲事業廢棄物之種類與數量分級，重大公害案件獎金顯著",
      },
    },
  },
  {
    pattern: /(噪音|擾鄰|大聲喧嘩|不當喇叭)/,
    citation: {
      shortLabel: "噪音超標",
      statute: "噪音管制法",
      article: "第 9 條 / 第 24 條",
      penalty: "噪音超過管制標準。處 3,000–30,000 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "continuous",
      reward: {
        available: true,
        authority: "各縣市環境保護局",
        basis: "各縣市噪音管制獎勵辦法（依地方規定）",
        rewardType: "percentage_of_fine",
        estimateRange: "依縣市規定，約罰鍰之 10%–30%",
        notes: "需經分貝計檢測達超標標準，且查獲屬實",
      },
    },
  },
  {
    pattern: /(空污|空氣污染|焚燒|露天燃燒|焚化紙錢|焚燒紙錢)/,
    citation: {
      shortLabel: "露天燃燒 / 空氣污染",
      statute: "空氣污染防制法",
      article: "第 32 條 / 第 67 條",
      penalty: "從事燃燒、融化、煉製等行為產生明顯之粒狀污染物逸散於空氣中。處 1,200 元 –10 萬元罰鍰；情節重大者更重。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      reward: {
        available: true,
        authority: "各縣市環境保護局",
        basis: "公私場所固定污染源違反空氣污染防制法案件民眾檢舉獎勵辦法",
        rewardType: "percentage_of_fine",
        estimateRange: "罰鍰之 10%–50%（依污染等級）",
        notes: "重大空污違規案件獎金較高",
      },
    },
  },
  {
    pattern: /(機車排氣|汽車排氣|黑煙|排氣超標)/,
    citation: {
      shortLabel: "車輛排氣超標",
      statute: "空氣污染防制法",
      article: "第 40 條 第 1 項",
      penalty: "汽機車排放空氣污染物超過排放標準。處 500–60,000 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      reward: {
        available: true,
        authority: "各縣市環境保護局",
        basis: "移動污染源民眾檢舉獎勵辦法（依地方規定）",
        rewardType: "fixed_amount",
        estimateRange: "約 100–500 元 / 案（依縣市與車種）",
        notes: "需提供清楚之車牌與排煙畫面；機車黑煙最常見",
      },
    },
  },
  {
    pattern: /(餐廳油煙|油煙排放|餐飲油煙)/,
    citation: {
      shortLabel: "餐飲業油煙未處理",
      statute: "空氣污染防制法",
      article: "第 32 條",
      penalty: "餐飲業未依規定設置防制設施或排放油煙。處 2,000 元 –10 萬元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "continuous",
      reward: {
        available: true,
        authority: "各縣市環境保護局",
        basis: "公私場所固定污染源違反空氣污染防制法案件民眾檢舉獎勵辦法",
        rewardType: "percentage_of_fine",
        estimateRange: "罰鍰之 10%–30%",
        notes: "需多次取證證明持續排放",
      },
    },
  },
];

// ============================================================================
// 建築違規
// ============================================================================
const buildingRules: RuleEntry[] = [
  {
    pattern: /(違章|違建|頂樓加蓋|頂加|加蓋|未經許可建造)/,
    citation: {
      shortLabel: "違章建築",
      statute: "建築法",
      article: "第 25 條 / 第 86 條",
      penalty: "未經申請審查許可並發給執照即擅自建造。處以建築物造價千分之五十以下罰鍰，並勒令停工補辦手續；不能補辦者強制拆除。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(未許可施工|無照施工|擅自施工)/,
    citation: {
      shortLabel: "未經許可施工",
      statute: "建築法",
      article: "第 86 條",
      penalty: "擅自建造者，處以建築物造價千分之五十以下罰鍰，並勒令停工補辦手續。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(結構危險|危樓|傾斜|裂縫|有公共安全之虞)/,
    citation: {
      shortLabel: "危險建築",
      statute: "建築法",
      article: "第 81 條",
      penalty: "對於傾頹或朽壞而有危害公共安全之建築物，主管建築機關應通知所有人或占有人停止使用。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
    },
  },
];

// ============================================================================
// 公寓大廈管理條例
// ============================================================================
const condominiumRules: RuleEntry[] = [
  {
    pattern: /(佔用|占用|公共空間|走廊|樓梯間|逃生通道|堵塞)/,
    citation: {
      shortLabel: "佔用公共空間 / 逃生通道",
      statute: "公寓大廈管理條例",
      article: "第 16 條 第 2 項 / 第 49 條",
      penalty: "區分所有權人不得於樓梯間、共同走廊、防火巷弄、開放空間堆置雜物。處 4–20 萬元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: false,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(隔間|分租|違法變更|改建|頂樓違建)/,
    citation: {
      shortLabel: "違法變更構造 / 隔間",
      statute: "公寓大廈管理條例",
      article: "第 8 條 / 第 49 條",
      penalty: "公寓大廈外觀、樓頂平台等變更構造或設置物，須依規約或區權會決議。違者處 4–20 萬元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: false,
      evidenceMode: "instantaneous",
    },
  },
  {
    pattern: /(寵物擾鄰|寵物.*妨礙|犬吠.*擾)/,
    citation: {
      shortLabel: "寵物飼養妨礙公共安寧",
      statute: "公寓大廈管理條例",
      article: "第 23 條",
      penalty: "住戶因飼養動物妨礙公共衛生、公共安寧及公共安全者，由管委會制止；情節重大時報請主管機關處理。",
      reportableByCitizen: true,
      policeInitiated: false,
      evidenceMode: "continuous",
    },
  },
];

const ruleMap: Record<ViolationCategory, RuleEntry[]> = {
  traffic: trafficRules,
  environment: environmentRules,
  building: buildingRules,
  condominium: condominiumRules,
};

/**
 * 比對違規描述，回傳所有命中之法規citation。
 * 若無命中，回傳該類別第一條（fallback）。
 */
export function matchLegalCitations(
  category: ViolationCategory,
  description: string,
): LegalCitation[] {
  const rules = ruleMap[category];
  const matched = rules.filter((r) => r.pattern.test(description)).map((r) => r.citation);
  if (matched.length > 0) return matched;
  return [rules[0]!.citation];
}

export function categoryLabel(category: ViolationCategory): string {
  return {
    traffic: "交通違規",
    environment: "環保違規",
    building: "建築違規",
    condominium: "公寓大廈違規",
  }[category];
}

/**
 * 取出所有交通違規規則（供測試與文件查閱）。
 */
export function listTrafficRules(): readonly LegalCitation[] {
  return trafficRules.map((r) => r.citation);
}

/**
 * 列出所有目前標記有舉發獎金的法規條目（跨四大類）。
 * 供測試與文件查閱用。
 */
export function listRewardableRules(): readonly LegalCitation[] {
  const all: LegalCitation[] = [];
  for (const list of Object.values(ruleMap)) {
    for (const r of list) {
      if (r.citation.reward?.available) all.push(r.citation);
    }
  }
  return all;
}

/**
 * 判斷一組 citations 中是否有任何一條有獎金。
 */
export function hasReward(citations: LegalCitation[]): boolean {
  return citations.some((c) => c.reward?.available === true);
}
