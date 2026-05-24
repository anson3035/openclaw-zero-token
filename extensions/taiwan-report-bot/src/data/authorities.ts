import type { ViolationCategory } from "../types.js";

interface CityAuthorities {
  traffic: { email: string; onlineForm?: string };
  environment: { email: string };
  building: { email: string };
  condominium: { email: string };
}

const CITY_TABLE: Record<string, CityAuthorities> = {
  台北市: {
    traffic: {
      email: "tpd@mail.taipei.gov.tw",
      onlineForm: "https://servicein.tcpd.gov.tw/TPDFiling/",
    },
    environment: { email: "epb@dep.gov.taipei" },
    building: { email: "udd@udd.gov.taipei" },
    condominium: { email: "udd@udd.gov.taipei" },
  },
  新北市: {
    traffic: {
      email: "10618@police.ntpc.gov.tw",
      onlineForm: "https://www.police.ntpc.gov.tw/cp-1729-115067-1.html",
    },
    environment: { email: "ntpcepb@ntpc.gov.tw" },
    building: { email: "publicworks@ntpc.gov.tw" },
    condominium: { email: "publicworks@ntpc.gov.tw" },
  },
  桃園市: {
    traffic: {
      email: "tpd@mail.tycg.gov.tw",
      onlineForm: "https://w3.tyhp.gov.tw/Front/TrafficCheck/Apply",
    },
    environment: { email: "tyepb@mail.tycg.gov.tw" },
    building: { email: "tyub@mail.tycg.gov.tw" },
    condominium: { email: "tyub@mail.tycg.gov.tw" },
  },
  台中市: {
    traffic: {
      email: "tcpb@taichung.gov.tw",
      onlineForm: "https://tcpdfiling.taichung.gov.tw/",
    },
    environment: { email: "epb@taichung.gov.tw" },
    building: { email: "ub@taichung.gov.tw" },
    condominium: { email: "ub@taichung.gov.tw" },
  },
  台南市: {
    traffic: {
      email: "tnpd@tainan.gov.tw",
      onlineForm: "https://trafficreport.tainan.gov.tw/",
    },
    environment: { email: "epb@tainan.gov.tw" },
    building: { email: "publicworks@tainan.gov.tw" },
    condominium: { email: "publicworks@tainan.gov.tw" },
  },
  高雄市: {
    traffic: {
      email: "khpb@kcg.gov.tw",
      onlineForm: "https://trafficreport.kcpd.gov.tw/",
    },
    environment: { email: "epb@kcg.gov.tw" },
    building: { email: "pwbu@kcg.gov.tw" },
    condominium: { email: "pwbu@kcg.gov.tw" },
  },
};

const DEFAULT_NATIONAL: CityAuthorities = {
  traffic: { email: "service@npa.gov.tw" },
  environment: { email: "service@moenv.gov.tw" },
  building: { email: "service@cpami.gov.tw" },
  condominium: { email: "service@cpami.gov.tw" },
};

export function lookupRecipients(
  city: string | undefined,
  category: ViolationCategory,
): { email: string; onlineForm?: string } {
  const table = (city && CITY_TABLE[city]) || DEFAULT_NATIONAL;
  return table[category];
}

export function supportedCities(): string[] {
  return Object.keys(CITY_TABLE);
}
