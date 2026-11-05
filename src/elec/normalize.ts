import type { CapacityRecord, KesRawRecord } from "./types.js";

/**
 * 응답 키를 원문 명세의 영문 항목명(대문자·밑줄) 형태로 맞춘다.
 * 명세는 TRANSELE_CPCTY처럼 대문자·밑줄로 적고 있으나, 실제 응답 형식은 인증키가 없어 확인하지 못했다.
 * 같은 항목을 camelCase(transeleCpcty)나 소문자(transele_cpcty)로 주는 경우에도 같은 항목으로 읽는다.
 */
export function toSpecKey(key: string): string {
  if (/[a-z]/.test(key) && /[A-Z]/.test(key) && !key.includes("_")) {
    return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  }
  return key.toUpperCase();
}

export function normalizeKeys(record: KesRawRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[toSpecKey(key)] = value;
  }
  return out;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** "1,000", " 22900 " 같은 값을 숫자로 읽는다. 숫자가 아니면 null (임의 보정하지 않음). */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asText(value);
  if (text === null) return null;
  const cleaned = text.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 원문 응답 1건을 화면·도구용 기록으로 바꾼다.
 * 개인 성명(대표자명·검사점검자명·시공업체대표자명)과 시공업체명은 수전용량 확인 목적과 무관하므로 버린다.
 */
export function normalizeRecord(rawRecord: KesRawRecord, sourceMonth: string): CapacityRecord {
  const r = normalizeKeys(rawRecord);
  return {
    category: asText(r.INSPCT_DIV),
    inspectionType: asText(r.RCEPT_TY),
    inspectionKind: asText(r.INSPCT_ASORT),
    equipmentType: asText(r.EQP_TY),
    businessName: asText(r.CMPNM),
    lotAddress: asText(r.LNM_ADRES),
    roadAddress: asText(r.RN_ADRES),
    legalDongCode: asText(r.PNU_CODE),
    unitNo: asText(r.MHRLS_NO),
    industry: asText(r.INDUST_KND),
    office: asText(r.BIZPLC),
    receivingVoltageV: parseNumber(r.TRANSELE_VLTGE),
    receivingCapacityKw: parseNumber(r.TRANSELE_CPCTY),
    generationVoltageV: parseNumber(r.GEN_VLTGE),
    generationCapacityKw: parseNumber(r.GEN_CPCTY),
    voltageV: parseNumber(r.VLTGE),
    capacityKw: parseNumber(r.CPCTY),
    raw: {
      receivingVoltage: asText(r.TRANSELE_VLTGE),
      receivingCapacity: asText(r.TRANSELE_CPCTY),
      generationVoltage: asText(r.GEN_VLTGE),
      generationCapacity: asText(r.GEN_CPCTY),
      voltage: asText(r.VLTGE),
      capacity: asText(r.CPCTY),
    },
    leakageJudgement: asText(r.LKMESM_JDNT),
    safetyGrade: asText(r.SAFE_GRAD),
    nonconformityCause: asText(r.IMPROPT_CODE),
    inspectionStart: asText(r.INSPCT_BGNDE),
    inspectionEnd: asText(r.INSPCT_ENDDE),
    result: asText(r.INSPCT_RESULT),
    checkType: asText(r.CHECK_TYPE),
    checkDetailType: asText(r.CHECK_DETAIL_TYPE),
    sourceMonth,
  };
}
