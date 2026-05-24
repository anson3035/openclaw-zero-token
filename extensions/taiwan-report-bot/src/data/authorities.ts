import type { ViolationCategory } from "../types.js";

export interface TrafficAuthority {
  email: string;
  onlineForm?: string;
  smsNumber?: string;
  smsNote?: string;
}

interface CityAuthorities {
  traffic: TrafficAuthority;
  environment: { email: string };
  building: { email: string };
  condominium: { email: string };
}

const CITY_TABLE: Record<string, CityAuthorities> = {
  台北市: {
    traffic: {
      email: "tpd@mail.taipei.gov.tw",
      onlineForm: "https://servicein.tcpd.gov.tw/TPDFiling/",
      smsNumber: "0911-510119",
      smsNote: "限違規停車；附車牌、時間、地點",
    },
    environment: { email: "epb@dep.gov.taipei" },
    building: { email: "udd@udd.gov.taipei" },
    condominium: { email: "udd@udd.gov.taipei" },
  },
  新北市: {
    traffic: {
      email: "10618@police.ntpc.gov.tw",
      onlineForm: "https://www.police.ntpc.gov.tw/cp-1729-115067-1.html",
      smsNumber: "0911-511110",
      smsNote: "限違規停車；附車牌、時間、地點",
    },
    environment: { email: "ntpcepb@ntpc.gov.tw" },
    building: { email: "publicworks@ntpc.gov.tw" },
    condominium: { email: "publicworks@ntpc.gov.tw" },
  },
  桃園市: {
    traffic: {
      email: "tpd@mail.tycg.gov.tw",
      onlineForm: "https://w3.tyhp.gov.tw/Front/TrafficCheck/Apply",
      smsNumber: "0911-512110",
      smsNote: "限違規停車；建議改用線上檢舉系統附照片",
    },
    environment: { email: "tyepb@mail.tycg.gov.tw" },
    building: { email: "tyub@mail.tycg.gov.tw" },
    condominium: { email: "tyub@mail.tycg.gov.tw" },
  },
  台中市: {
    traffic: {
      email: "tcpb@taichung.gov.tw",
      onlineForm: "https://tcpdfiling.taichung.gov.tw/",
      smsNumber: "0911-513110",
      smsNote: "限違規停車；附車牌、時間、地點",
    },
    environment: { email: "epb@taichung.gov.tw" },
    building: { email: "ub@taichung.gov.tw" },
    condominium: { email: "ub@taichung.gov.tw" },
  },
  台南市: {
    traffic: {
      email: "tnpd@tainan.gov.tw",
      onlineForm: "https://trafficreport.tainan.gov.tw/",
      smsNumber: "0911-514110",
      smsNote: "限違規停車；附車牌、時間、地點",
    },
    environment: { email: "epb@tainan.gov.tw" },
    building: { email: "publicworks@tainan.gov.tw" },
    condominium: { email: "publicworks@tainan.gov.tw" },
  },
  高雄市: {
    traffic: {
      email: "khpb@kcg.gov.tw",
      onlineForm: "https://trafficreport.kcpd.gov.tw/",
      smsNumber: "0911-515110",
      smsNote: "限違規停車；附車牌、時間、地點",
    },
    environment: { email: "epb@kcg.gov.tw" },
    building: { email: "pwbu@kcg.gov.tw" },
    condominium: { email: "pwbu@kcg.gov.tw" },
  },
};

const DEFAULT_NATIONAL: CityAuthorities = {
  traffic: {
    email: "service@npa.gov.tw",
    smsNote: "未知縣市；請至內政部警政署「警政服務App」或撥 110 確認當地簡訊檢舉專線",
  },
  environment: { email: "service@moenv.gov.tw" },
  building: { email: "service@cpami.gov.tw" },
  condominium: { email: "service@cpami.gov.tw" },
};

export function lookupRecipients(
  city: string | undefined,
  category: ViolationCategory,
): { email: string; onlineForm?: string; smsNumber?: string; smsNote?: string } {
  const table = (city && CITY_TABLE[city]) || DEFAULT_NATIONAL;
  const entry = table[category];
  if (category === "traffic") return entry as TrafficAuthority;
  return entry as { email: string };
}

export function supportedCities(): string[] {
  return Object.keys(CITY_TABLE);
}

/**
 * Normalize Taiwan mobile numbers to E.164 (+886...) for sms: URIs.
 * "0911-510119" / "0911510119" / "+886911510119" → "+886911510119"
 */
export function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+886${digits.slice(1)}`;
  return digits;
}
