import type { LegalCitation, ViolationCategory } from "../types.js";

interface RuleEntry {
  pattern: RegExp;
  citation: LegalCitation;
}

const trafficRules: RuleEntry[] = [
  {
    pattern: /(違停|紅線|黃線|併排|騎樓|斑馬線|人行道停車)/,
    citation: {
      statute: "道路交通管理處罰條例",
      article: "第 56 條",
      penalty: "汽車駕駛人停車時，於禁止臨時停車處所停車者，處新臺幣 600 元以上 1,200 元以下罰鍰。",
    },
  },
  {
    pattern: /(闖紅燈|紅燈右轉|搶黃燈)/,
    citation: {
      statute: "道路交通管理處罰條例",
      article: "第 53 條",
      penalty: "汽車駕駛人，行經有燈光號誌管制之交岔路口闖紅燈者，處新臺幣 1,800 元以上 5,400 元以下罰鍰。",
    },
  },
  {
    pattern: /(未禮讓行人|不禮讓行人|行人穿越)/,
    citation: {
      statute: "道路交通管理處罰條例",
      article: "第 44 條第 2 項",
      penalty: "汽車駕駛人，行近行人穿越道不依規定讓行人優先通行者，處 6,000 元罰鍰。",
    },
  },
  {
    pattern: /(逆向|逆行|單行道)/,
    citation: {
      statute: "道路交通管理處罰條例",
      article: "第 45 條",
      penalty: "於單行道行駛車輛不依規定方向行駛者，處 600 元以上 1,800 元以下罰鍰。",
    },
  },
];

const environmentRules: RuleEntry[] = [
  {
    pattern: /(亂丟垃圾|棄置|丟棄|隨意拋|菸蒂|果皮)/,
    citation: {
      statute: "廢棄物清理法",
      article: "第 27 條",
      penalty: "在指定清除地區內，不得任意棄置垃圾。違者處 1,200 元以上 6,000 元以下罰鍰（第 50 條）。",
    },
  },
  {
    pattern: /(廢棄物|傾倒|爐渣|事業廢棄物|有害)/,
    citation: {
      statute: "廢棄物清理法",
      article: "第 46 條",
      penalty: "任意棄置有害事業廢棄物者，處 1 年以上 5 年以下有期徒刑，得併科 1,500 萬元以下罰金。",
    },
  },
  {
    pattern: /(噪音|擾鄰|喇叭|大聲|喧嘩)/,
    citation: {
      statute: "噪音管制法",
      article: "第 9 條",
      penalty: "噪音超過管制標準者，處 3,000 元以上 30,000 元以下罰鍰。",
    },
  },
  {
    pattern: /(空污|空氣污染|燃燒|焚燒|露天)/,
    citation: {
      statute: "空氣污染防制法",
      article: "第 32 條",
      penalty: "從事燃燒、融化、煉製等行為產生明顯之粒狀污染物，逸散於空氣中者，處 1,200 元以上 10 萬元以下罰鍰。",
    },
  },
];

const buildingRules: RuleEntry[] = [
  {
    pattern: /(違章|違建|頂樓加蓋|增建|加蓋)/,
    citation: {
      statute: "建築法",
      article: "第 25 條",
      penalty: "建築物非經申請直轄市、縣（市）主管建築機關之審查許可並發給執照，不得擅自建造或使用。",
    },
  },
  {
    pattern: /(未許可施工|無照施工|擅自施工)/,
    citation: {
      statute: "建築法",
      article: "第 86 條",
      penalty: "擅自建造者，處以建築物造價千分之五十以下罰鍰，並勒令停工補辦手續。",
    },
  },
  {
    pattern: /(結構|安全|危樓|搖晃|傾斜)/,
    citation: {
      statute: "建築法",
      article: "第 81 條",
      penalty: "對於傾頹或朽壞而有危害公共安全之建築物，主管建築機關應通知所有人或占有人停止使用。",
    },
  },
];

const condominiumRules: RuleEntry[] = [
  {
    pattern: /(佔用|占用|公共空間|走廊|樓梯間|逃生)/,
    citation: {
      statute: "公寓大廈管理條例",
      article: "第 16 條第 2 項",
      penalty: "區分所有權人不得於私設通路、防火間隔、防火巷弄、開放空間、退縮空地、樓梯間、共同走廊堆置雜物。違者處 4 萬元以上 20 萬元以下罰鍰。",
    },
  },
  {
    pattern: /(隔間|分租|違法變更|改建)/,
    citation: {
      statute: "公寓大廈管理條例",
      article: "第 8 條",
      penalty: "公寓大廈周圍上下、外牆面、樓頂平台及不屬專有部分之防空避難設備，其變更構造、顏色、設置廣告物等，應依規約或區權會決議。違者處 4 萬元以上 20 萬元以下罰鍰。",
    },
  },
  {
    pattern: /(寵物|噪音|擾鄰)/,
    citation: {
      statute: "公寓大廈管理條例",
      article: "第 23 條",
      penalty: "公寓大廈住戶因飼養動物妨礙公共衛生、公共安寧及公共安全者，由管委會制止；情節重大時報請主管機關處理。",
    },
  },
];

const ruleMap: Record<ViolationCategory, RuleEntry[]> = {
  traffic: trafficRules,
  environment: environmentRules,
  building: buildingRules,
  condominium: condominiumRules,
};

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
