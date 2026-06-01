export type ViolationCategory = "traffic" | "environment" | "building" | "condominium";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface MediaEvidence {
  filePath: string;
  mimeType: string;
  capturedAt?: Date;
  gps?: GeoPoint;
  sha256: string;
  source: "telegram";
  sourceMessageId: number;
  sourceChatId: number;
}

export interface ReporterIdentity {
  name: string;
  contact: string; // phone or email
  nationalId?: string; // optional 身分證字號
}

/**
 * 車輛類型 — 由 vision 模型回報，用於：
 *   - EV 不應觸發空污 §40 排氣超標
 *   - 計程車 / 公務車於招呼站 / 公務停車格有豁免規則
 *   - 大型車 / 重機適用條文不同
 */
export type VehicleType =
  | "car" // 一般小客車
  | "suv"
  | "truck" // 貨車
  | "bus" // 大客車
  | "motorcycle_light" // 輕/普通機車 (≤250cc)
  | "motorcycle_heavy" // 大型重型機車 (>250cc)
  | "ev_car" // 電動小客車（E 前綴牌）
  | "ev_motorcycle" // 電動機車（綠牌 + 電動車標）
  | "rental_ev" // 租賃 EV（RE 前綴）
  | "taxi" // 計程車（T*/Y* 前綴）
  | "government" // 公務車
  | "police" // 警車
  | "unknown";

/**
 * 違規場景類型 — 由 vision 模型回報，用於精確路由法條。
 * 比起單純文字描述更可靠。
 */
export type SceneType =
  | "red_line" // 紅線（禁止臨時停車）
  | "yellow_line" // 黃線（禁止停車）
  | "sidewalk" // 一般人行道
  | "arcade" // 騎樓
  | "wheelchair_path" // 無障礙通道（含黃色引導磚）
  | "fire_facility" // 消防栓 / 消防車出入口
  | "bus_stop" // 公車 / 計程車招呼站
  | "intersection" // 交岔路口 10 m 內
  | "disabled_parking" // 身心障礙專用車位
  | "motorcycle_grid" // 機車停車格
  | "metered_parking" // 計時收費停車格
  | "designated_parking" // 一般合法停車格
  | "bicycle_lane" // 自行車道 / 慢車道（綠色道路）
  | "private_property" // 私人土地 / 派出所等權威場域
  | "moving_violation" // 動態違規（闖紅、未禮讓）
  | "unknown";

export interface AnalyzedViolation {
  category: ViolationCategory;
  subject: string;
  description: string;
  identifiers: {
    licensePlate?: string;
    structureDescription?: string;
    wasteType?: string;
    occupiedArea?: string;
  };
  confidence: "high" | "medium" | "low";
  evidenceGaps: string[];
  /** 車輛類型 — 預設 unknown，由 vision 模型回報。 */
  vehicleType?: VehicleType;
  /** 違規場景類型 — 用於精確路由法條。 */
  sceneType?: SceneType;
  /**
   * 畫面中可見之告示牌 / 看板 / 路面標字文字內容（OCR）。
   * 例：["請留輪椅通道", "禁止停車違規拖吊", "24 小時禁停"]
   * compliance gate 用此加重證據力或觸發特殊條文（如身障 §57）。
   */
  signTexts?: string[];
  /**
   * 應馬賽克處理之第三人隱私區域（bbox 為 0..1 normalized）。
   * Vision 模型應辨識違規無關之人臉、車牌、住址門牌、車內人物。
   */
  privacyRegions?: PrivacyRegion[];
  /**
   * 附加違規車牌 — 同畫面內多輛違規車輛時使用。
   * 主車牌仍在 identifiers.licensePlate；本陣列為**其他**違規車輛。
   * /batch 指令會逐一拆成獨立案件。
   */
  additionalPlates?: AdditionalPlate[];
}

export interface AdditionalPlate {
  licensePlate: string;
  /** Per-plate vehicle type（如有 LPR 多次掃描可得）*/
  vehicleType?: VehicleType;
  /** 此車違規描述（若與主車一致則重複；不同則拆案分述）*/
  description?: string;
  /** LPR 信心 */
  confidence: number;
}

export interface PrivacyRegion {
  /** 區域類型 */
  type: "face" | "plate" | "address" | "person" | "other";
  /** 為何需要馬賽克 */
  reason: string;
  /** Normalized 0..1 bounding box */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ResolvedAddress {
  full: string;
  city?: string;
  district?: string;
  source: "exif-geocode" | "user-input";
}

export interface ReportContext {
  evidence: MediaEvidence[]; // primary at [0]; additional for continuous-violation evidence
  analysis: AnalyzedViolation;
  address: ResolvedAddress;
  userNote?: string;
  reporter?: ReporterIdentity;
  /**
   * True when the user has explicitly confirmed (or manually corrected) the
   * license plate via /plate. Required by compliance gate before /send.
   * If LPR low-confidence and this is false, /send is blocked.
   */
  plateConfirmed?: boolean;
  /**
   * Whether the most recent LPR pass flagged the plate as needing human
   * verification (low confidence, ambiguity, or severe artifacts).
   */
  plateRequiresVerification?: boolean;
}

export interface ComplianceCheck {
  ok: boolean;
  issues: string[]; // human-readable blockers / warnings before sending
}

/**
 * 舉發獎金資訊（針對個別違規類型）。
 *
 * 法源主要為：
 * - 環境部《違反廢棄物清理法案件民眾檢舉獎金支給辦法》
 * - 環境部《公私場所固定污染源違反空氣污染防制法案件民眾檢舉獎勵辦法》
 * - 各縣市環保局獎勵辦法（噪音、水污、油煙）
 * - 菸害防制法檢舉獎勵（部分縣市）
 *
 * ⚠ 重要：實際獎金金額由各縣市環保局/主管機關依個案核發，
 * 此處範圍為一般民眾常見額度，可能因地方規定、罰鍰金額、查獲結果而異。
 */
export interface RewardProgram {
  /** 是否有舉發獎金。多數交通/建築/公寓大廈案件為 false。 */
  available: boolean;
  /** 主管機關（核發單位）。 */
  authority?: string;
  /** 法源依據。 */
  basis?: string;
  /** 獎金結構類型。 */
  rewardType?: "percentage_of_fine" | "fixed_amount" | "tiered";
  /** 人類可讀的金額範圍（如 "罰鍰之 1/2"、"100–500 元"、"最高 50 萬元"）。 */
  estimateRange?: string;
  /** 額外備註（如「需查獲屬實後核發」、「依各縣市規定」）。 */
  notes?: string;
}

export type EvidenceMode = "instantaneous" | "continuous" | "moving";

/**
 * 裁罰主體（道交條例 §85）。
 * - driver: 罰駕駛人（如闖紅燈、未禮讓行人 — 駕駛在場可辨識）
 * - owner:  罰車輛所有人（如違停 — 駕駛人不在場）
 * - either: 視具體情況，可舉證者罰實際駕駛
 */
export type LiabilityTarget = "driver" | "owner" | "either";

/**
 * 刑罰替代法條 — 提示使用者該違規可能同時構成刑事罪。
 * 依《行政罰法 §26》一事不二罰原則，刑罰優先。
 * 系統提示使用者改撥 110 由警員到場處理。
 */
export interface CriminalAlternative {
  statute: string;       // 例：刑法
  article: string;       // 例：第 190-1 條
  description: string;   // 例：流放毒物罪
  preferredAction: string; // 例：請先撥打 110 由警員到場處理；不適合循民眾檢舉管道
}

export interface LegalCitation {
  statute: string;
  article: string;
  penalty: string;
  shortLabel?: string;
  /** 是否屬道交條例 §7-1 民眾可檢舉之違規。false = 限警察執行。 */
  reportableByCitizen?: boolean;
  /** 是否屬道交條例 §7-2 警察可逕行舉發之違規。 */
  policeInitiated?: boolean;
  evidenceMode?: EvidenceMode;
  reward?: RewardProgram;
  /** 裁罰主體（道交 §85）。預設 either。 */
  liabilityTarget?: LiabilityTarget;
  /** 刑罰替代法條 — 若有則提示刑罰優先。 */
  criminalAlternative?: CriminalAlternative;
  /** 舉發時效（自違規日起算之天數）。預設 90（道交 §90 第 1 項）。 */
  statuteOfLimitationsDays?: number;
}

export interface SmsArtifact {
  number: string;
  body: string;
  deepLink: string;
  note?: string;
}

export interface ReportArtifact {
  /** 本系統內部追蹤號（非主管機關官方受文號）。格式：TRB-YYYYMMDD-NNNNN */
  trackingId: string;
  markdown: string;
  emailSubject: string;
  emailBody: string;
  recipients: string[];
  onlineFormUrl?: string;
  sms?: SmsArtifact;
  legalCitations: LegalCitation[];
  compliance: ComplianceCheck;
}
