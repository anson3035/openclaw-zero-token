import type {
  CriminalAlternative,
  LegalCitation,
  LiabilityTarget,
  ViolationCategory,
} from "../types.js";

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
      liabilityTarget: "owner", // 違停駕駛多不在場
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
  // ===== 自行車道 / 慢車道占用 (v4.6 新增) =====
  {
    pattern: /(自行車道|慢車道|機慢車優先|綠色.*車道|腳踏車道|機車優先道|YouBike.*道)/,
    citation: {
      shortLabel: "違規停車（自行車道/慢車道）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 4 款（類推適用快車道）",
      penalty: "占用自行車道、慢車道或機車優先道停車，致影響慢車通行安全。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      liabilityTarget: "owner",
    },
  },

  // ===== v4.8：道路堆置障礙物（三角錐 / 廢輪胎 / 鐵架 / 路霸） =====
  // 道交 §82-1（90 修法後升級為單獨條文）：占用道路設置障礙物之「占地為王」行為。
  // 命中要件：描述含三角錐、輪胎、鐵架、雜物、占地等用語；常與違停同時發生。
  {
    pattern: /(三角錐|交通錐|路障|廢輪胎|占地為王|占地|占道|占用道路|占用車道|占用路面|擺設.*攤|堆置.*道路|障礙物.*道路|道路.*障礙物|鐵架.*道路|路霸|雜物.*路面|私設.*停車)/,
    citation: {
      shortLabel: "道路擺設障礙物（占道）",
      statute: "道路交通管理處罰條例",
      article: "第 82-1 條",
      penalty:
        "未經許可在道路設置、堆積、置放足以妨礙交通之物（如三角錐、廢輪胎、鐵架、攤位）。處行為人或設置人 1,200–2,400 元罰鍰，並命令撤除；不撤除者代為清除費用由行為人負擔。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      liabilityTarget: "either", // 行為人優先，若不明則對土地/騎樓所有人
      statuteOfLimitationsDays: 90,
    },
  },

  // ===== v4.8：車庫 / 巷口 / 出入口 5 m 內停車 =====
  // 道交 §56 第 1 項 第 6 款 — 機關、學校、醫院、銀行、戲院、商場、其他公眾出入處所
  // 之出入口五公尺內停車。常見場景：擋住住戶車庫鐵捲門、店家騎樓出入口、巷口。
  {
    pattern: /(車庫.*出入口|車庫前|擋住車庫|擋.*車庫|出入口.*停|出入口.*5.*公尺|出入口.*五.*公尺|巷口.*停|擋住巷口|擋.*巷口|店家.*出入口|騎樓.*出入口)/,
    citation: {
      shortLabel: "違規停車（出入口 5 m 內）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 6 款",
      penalty:
        "在機關、學校、醫院、銀行、戲院、商場及其他公眾出入之場所出入口或道路修理地段或正在工作中之道路五公尺內停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      liabilityTarget: "owner",
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

  // ===== v4.9：機車 / 自行車駕駛人駕駛時吸菸（2023 菸防法新修） =====
  // 菸害防制法 §17 III 第 12 款（民國 112 年 3 月 22 日施行）：
  //   「任何強制使用安全帽之機車及自行車駕駛人，駕駛時不得吸菸」
  // §49 罰 2,000–10,000 元。主管機關：地方衛生局（檢舉接受窗口）。
  // 為民眾可檢舉之違規，採證一張清晰持菸畫面即可（instantaneous）。
  //
  // 注意：道交 §31 第 5 項僅罰「汽車」駕駛人吸菸，機車吸菸應走菸防法。
  {
    pattern: /(機車.*吸菸|機車.*抽菸|機車.*持菸|機車.*手持菸|騎車.*吸菸|騎車.*抽菸|騎士.*持菸|騎士.*吸菸|騎士.*抽菸|機車.*點菸|機車.*咬菸|機車駕駛.*菸)/,
    citation: {
      shortLabel: "機車駕駛人駕駛時吸菸（菸防法）",
      statute: "菸害防制法",
      article: "第 17 條 第 3 項 第 12 款 / 第 49 條",
      penalty:
        "任何強制使用安全帽之機車及自行車駕駛人，駕駛時不得吸菸。處 2,000–10,000 元罰鍰（衛生局裁罰）。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      liabilityTarget: "driver",
      reward: {
        available: true,
        authority: "地方衛生局",
        basis: "菸害防制法 §32 各縣市自治條例（多數縣市 50% 罰鍰）",
        rewardType: "percentage_of_fine",
        estimateRange: "罰鍰之 1/4 至 1/2（依各縣市規定）",
        notes: "須查獲屬實後核發；部分縣市需檢附本人身分證明。",
      },
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

  // ============ 停車超出格線（車尾入侵人行道）— 特殊 §56-1-4 變體 ============
  {
    pattern: /(車檔|輪擋|越過.*車檔|跨越.*車檔|跨越.*輪擋|超出.*停車格|超出.*格線|尾.*壓.*人行道|尾.*入.*人行道|車身.*越過|越界停車)/,
    citation: {
      shortLabel: "停車超出格線（車尾入侵人行道）",
      statute: "道路交通管理處罰條例",
      article: "第 56 條 第 1 項 第 4 款",
      penalty: "停車超出停車格線致車身延伸至人行道或車道，視同人行道停車。處 600–1,200 元罰鍰。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      liabilityTarget: "owner",
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
  // ===== 建築法 §90 騎樓淨空 — 違停騎樓除道交 §56-1-4 外，本條同時適用 =====
  {
    pattern: /(騎樓.*停|停.*騎樓|佔用騎樓|占用騎樓|騎樓.*堆置|騎樓.*雜物)/,
    citation: {
      shortLabel: "騎樓淨空違反（建築法）",
      statute: "建築法",
      article: "第 90 條 / 第 91 條",
      penalty: "騎樓地面層之空間，不得堆放雜物、設置攤位或停車。違反者處新台幣 6,000 元以上 30,000 元以下罰鍰，並限期改善。",
      reportableByCitizen: true,
      policeInitiated: false,
      evidenceMode: "instantaneous",
      liabilityTarget: "owner",
    },
  },
  // ===== 身心障礙者權益保障法 §57 無障礙環境 =====
  {
    pattern: /(無障礙|輪椅通道|輪椅.*通|盲人引導|視障引導|身心障礙.*通行)/,
    citation: {
      shortLabel: "佔用無障礙通道",
      statute: "身心障礙者權益保障法",
      article: "第 57 條 / 第 88 條（並依各縣市無障礙設施管理自治條例）",
      penalty: "違反公共場所無障礙環境設置標準，致影響身障者通行。處 6,000 元以上 30,000 元以下罰鍰，並命限期改善。",
      reportableByCitizen: true,
      policeInitiated: true,
      evidenceMode: "instantaneous",
      liabilityTarget: "owner",
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
 * 從 citation 之 shortLabel 推導裁罰主體（道交 §85）：
 *   - 違停 / 佔用 / 排氣 / 油煙 / 噪音 / 違建 → owner (車主 / 場所所有人)
 *   - 闖紅燈 / 紅燈右轉 / 逆向 / 蛇行 / 超車 / 迴轉 / 未禮讓 / 行駛人行道 /
 *     吸菸 / 安全帽 / 安全帶 / 酒駕 / 安全距離 / 超速 → driver (駕駛在場)
 *   - 亂丟垃圾 / 棄置事業廢棄物 → either (個人或法人視情況)
 */
function inferLiabilityTarget(c: LegalCitation): LiabilityTarget {
  if (c.liabilityTarget) return c.liabilityTarget;
  const label = c.shortLabel ?? "";
  if (/違規停車|佔用|並排|計時|油煙|噪音|排氣|違章|危險建築|未許可施工|違法變更|寵物/.test(label)) {
    return "owner";
  }
  if (/闖紅燈|紅燈右轉|逆向|蛇行|超車|迴轉|未禮讓|機車行駛人行道|吸菸|安全帽|安全帶|酒|安全距離|超速/.test(label)) {
    return "driver";
  }
  return "either";
}

/**
 * 從 shortLabel 推導刑罰替代法條（行政罰法 §26 一事不二罰，刑罰優先）：
 *   - 棄置有害事業廢棄物 → 刑法 §190-1 流放毒物罪
 *   - 蛇行 / 危險駕駛   → 刑法 §185 妨害公眾往來安全
 *   - 酒後駕車         → 刑法 §185-3 公共危險罪
 */
function inferCriminalAlternative(c: LegalCitation): CriminalAlternative | undefined {
  if (c.criminalAlternative) return c.criminalAlternative;
  const label = c.shortLabel ?? "";
  if (/有害事業廢棄物|棄置.*廢棄物/.test(label)) {
    return {
      statute: "中華民國刑法",
      article: "第 190-1 條",
      description: "流放毒物或毒害物罪（1 年以上 7 年以下有期徒刑）",
      preferredAction: "屬刑事案件，請優先撥打 110 並向地方檢察署提告，不宜僅循民眾檢舉管道。",
    };
  }
  if (/蛇行|危險駕駛/.test(label)) {
    return {
      statute: "中華民國刑法",
      article: "第 185 條",
      description: "妨害公眾往來安全罪（5 年以下有期徒刑）",
      preferredAction: "若情節重大（如多次危險變換車道造成他車緊急閃避），請優先撥打 110，並保留行車記錄器影片。",
    };
  }
  if (/酒/.test(label) && /駕/.test(label)) {
    return {
      statute: "中華民國刑法",
      article: "第 185-3 條",
      description: "不能安全駕駛罪（2 年以下有期徒刑）",
      preferredAction: "酒駕為刑事案件，民眾無法檢舉。請立即撥打 110 由警員攔檢。",
    };
  }
  return undefined;
}

/**
 * 從 category 推導舉發時效（自違規日起天數）。
 *   - 交通：90 日（道交 §90 第 1 項）
 *   - 環保：365 日（依各環保專法）
 *   - 建築 / 公寓大廈：無（持續違規狀態）
 */
function inferStatuteOfLimitations(c: LegalCitation): number | undefined {
  if (c.statuteOfLimitationsDays !== undefined) return c.statuteOfLimitationsDays;
  if (c.statute === "道路交通管理處罰條例") return 90;
  return undefined;
}

/** 將 enrichment 套用到 citation 上。 */
function enrich(c: LegalCitation): LegalCitation {
  const enriched: LegalCitation = {
    ...c,
    liabilityTarget: inferLiabilityTarget(c),
  };
  const ca = inferCriminalAlternative(c);
  if (ca) enriched.criminalAlternative = ca;
  const sol = inferStatuteOfLimitations(c);
  if (sol !== undefined) enriched.statuteOfLimitationsDays = sol;
  return enriched;
}

/**
 * 場景類型 → 描述關鍵字 mapping。
 * Vision 模型回報 sceneType 後，自動附加對應關鍵字到 description，
 * 確保 pattern matching 能命中正確法條（避免 vision 描述用詞變化造成漏判）。
 */
const SCENE_TYPE_KEYWORDS: Record<string, string> = {
  red_line: " 紅線",
  yellow_line: " 黃線",
  sidewalk: " 人行道",
  arcade: " 騎樓",
  wheelchair_path: " 無障礙 輪椅通道",
  fire_facility: " 消防栓 消防車出入口",
  bus_stop: " 公車招呼站",
  intersection: " 交岔路口",
  disabled_parking: " 身心障礙專用車位",
  motorcycle_grid: " 機車格",
  metered_parking: " 計時收費 停車格",
  bicycle_lane: " 自行車道 慢車道 機慢車優先",
  moving_violation: " 動態違規",
};

/**
 * 比對違規描述 + 場景類型，回傳所有命中之法規 citation（經 enrichment 處理）。
 *
 * v4.2 新增：sceneType 參數讓 vision 模型的結構化判斷直接驅動法條命中，
 * 而不依賴 description 文字是否包含關鍵字。
 *
 * 若無命中，回傳該類別第一條（fallback）。
 */
export function matchLegalCitations(
  category: ViolationCategory,
  description: string,
  sceneType?: string,
): LegalCitation[] {
  const rules = ruleMap[category];
  const enhancedDesc =
    sceneType && SCENE_TYPE_KEYWORDS[sceneType]
      ? description + SCENE_TYPE_KEYWORDS[sceneType]
      : description;
  const matched = rules
    .filter((r) => r.pattern.test(enhancedDesc))
    .map((r) => enrich(r.citation));
  if (matched.length > 0) return matched;
  return [enrich(rules[0]!.citation)];
}

/**
 * 跨類別比對：當違規涉及多個類別時（如騎樓違停 = traffic §56-1-4 + building §90），
 * 同時 lookup 多個類別，回傳合併之 citations。
 */
export function matchLegalCitationsMulti(
  primaryCategory: ViolationCategory,
  description: string,
  sceneType?: string,
): LegalCitation[] {
  const out: LegalCitation[] = [];
  const seen = new Set<string>();

  // primary 必查
  for (const c of matchLegalCitations(primaryCategory, description, sceneType)) {
    const key = `${c.statute}|${c.article}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }

  // 騎樓 → 加查 building §90
  if (sceneType === "arcade" && primaryCategory === "traffic") {
    for (const c of matchLegalCitations("building", description + " 騎樓", "arcade")) {
      const key = `${c.statute}|${c.article}`;
      if (c.statute === "建築法" && !seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
  }

  // 無障礙通道 → 加查 building §57
  if (sceneType === "wheelchair_path" && primaryCategory === "traffic") {
    for (const c of matchLegalCitations("building", description + " 無障礙 輪椅通道", "wheelchair_path")) {
      const key = `${c.statute}|${c.article}`;
      if (c.statute === "身心障礙者權益保障法" && !seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
  }

  return out;
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
