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
  source: "telegram";
  sourceMessageId: number;
  sourceChatId: number;
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
  evidence: MediaEvidence;
  analysis: AnalyzedViolation;
  address: ResolvedAddress;
  userNote?: string;
}

export interface LegalCitation {
  statute: string;
  article: string;
  penalty: string;
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
}
