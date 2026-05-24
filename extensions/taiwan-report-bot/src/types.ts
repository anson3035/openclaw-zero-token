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
 * 採證要件：
 * - instantaneous: 單張清晰照片即可（紅線、人行道、闖紅燈、騎樓、消防栓、公車站、身障車位…）
 * - continuous:    需 ≥ 2 張、間隔 ≥ 3 分鐘（黃線、限時收費停車格、一般違停未指明場所）
 * - moving:        動態違規，需錄影或連續多張（蛇行、未禮讓行人、違規迴轉、超車）
 */
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
