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
  /** 舉發獎金資訊。未設定者預設視為 available=false。 */
  reward?: RewardProgram;
}

export interface SmsArtifact {
  number: string;
  body: string;
  deepLink: string;
  note?: string;
}

export interface ReportArtifact {
  markdown: string;
  emailSubject: string;
  emailBody: string;
  recipients: string[];
  onlineFormUrl?: string;
  sms?: SmsArtifact;
  legalCitations: LegalCitation[];
  compliance: ComplianceCheck;
}
