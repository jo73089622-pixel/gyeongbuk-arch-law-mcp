/**
 * 실제 인증키로 OpenAPI 응답을 검증할 때 쓰는 요약 함수.
 * 요약에는 인증키·상호명·주소·성명 원문을 넣지 않고, 글자 모양(마스킹)과 건수만 남긴다.
 */

import { normalizeKeys } from "./normalize.js";
import type { KesRawRecord } from "./types.js";
import { KES_RESPONSE_FIELDS } from "./types.js";

/** 원문을 감추고 모양만 남긴다: 한글·영문 → ○, 숫자 → #, 별표·공백·기호는 그대로 (예: "가나***" → "○○***") */
export function shapeOf(value: unknown): string {
  return String(value ?? "")
    .replace(/[0-9]/g, "#")
    .replace(/[가-힣A-Za-z]/g, "○");
}

/** 지번주소에 번지(숫자)가 있는지 */
export function hasLotNumber(addr: string): boolean {
  return /\d/.test(addr);
}

/** 도로명주소 끝에 건물번호가 있는지 (예: "…로 12", "…길 3-1") */
export function hasBuildingNumber(addr: string): boolean {
  return /(로|길)\s*\d+(-\d+)?(\s|,|\(|$)/.test(addr) || /\s\d+(-\d+)?$/.test(addr.trim());
}

function count<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface RecordSummary {
  records: number;
  /** 응답에 실제로 나온 항목 이름 */
  fieldsPresent: string[];
  /** 명세에 있으나 응답에 없는 항목 */
  specFieldsMissing: string[];
  /** 명세에 없는데 응답에 있는 항목 */
  extraFields: string[];
  businessName: { nonEmpty: number; withAsterisk: number; shapes: string[] };
  lotAddress: { nonEmpty: number; withNumber: number; shapes: string[] };
  roadAddress: { nonEmpty: number; withBuildingNo: number; shapes: string[] };
  receivingCapacity: { nonEmpty: number; numeric: number; min: number | null; max: number | null; samples: string[] };
  receivingVoltage: { distinct: string[] };
  category: Record<string, number>;
  inspectionType: Record<string, number>;
  equipmentType: Record<string, number>;
  /** 페이지 나눔 관련 항목의 값 (개인정보 아님) */
  paging: Record<string, string[]>;
  /** SIDO·SIGUNGU 항목의 값 */
  regionCodes: Record<string, string[]>;
  /** 주소에 '남구'·'북구'가 들어간 기록 수 (포항 구 구분 확인용) */
  district: { 남구: number; 북구: number; 둘다아님: number };
}

function distinctShapes(values: string[], max = 5): string[] {
  return [...new Set(values.map(shapeOf))].slice(0, max);
}

export function summarizeRecords(rawRecords: KesRawRecord[]): RecordSummary {
  const rows = rawRecords.map(normalizeKeys);
  const text = (r: Record<string, unknown>, k: string) => (r[k] === null || r[k] === undefined ? "" : String(r[k]).trim());
  const present = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) present.add(k);
  const spec = Object.keys(KES_RESPONSE_FIELDS);

  const names = rows.map((r) => text(r, "CMPNM")).filter(Boolean);
  const lots = rows.map((r) => text(r, "LNM_ADRES")).filter(Boolean);
  const roads = rows.map((r) => text(r, "RN_ADRES")).filter(Boolean);
  const caps = rows.map((r) => text(r, "TRANSELE_CPCTY")).filter(Boolean);
  const capNums = caps.map((c) => Number(c.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
  const allAddr = rows.map((r) => `${text(r, "LNM_ADRES")} ${text(r, "RN_ADRES")}`);

  return {
    records: rows.length,
    fieldsPresent: [...present].sort(),
    specFieldsMissing: spec.filter((k) => !present.has(k)),
    extraFields: [...present].filter((k) => !spec.includes(k)).sort(),
    businessName: { nonEmpty: names.length, withAsterisk: names.filter((n) => n.includes("*")).length, shapes: distinctShapes(names) },
    lotAddress: { nonEmpty: lots.length, withNumber: lots.filter(hasLotNumber).length, shapes: distinctShapes(lots) },
    roadAddress: { nonEmpty: roads.length, withBuildingNo: roads.filter(hasBuildingNumber).length, shapes: distinctShapes(roads) },
    receivingCapacity: {
      nonEmpty: caps.length,
      numeric: capNums.length,
      min: capNums.length ? Math.min(...capNums) : null,
      max: capNums.length ? Math.max(...capNums) : null,
      samples: [...new Set(caps)].slice(0, 8),
    },
    receivingVoltage: { distinct: [...new Set(rows.map((r) => text(r, "TRANSELE_VLTGE")).filter(Boolean))].slice(0, 8) },
    category: count(rows, (r) => text(r, "INSPCT_DIV") || "(없음)"),
    inspectionType: count(rows, (r) => text(r, "RCEPT_TY") || "(없음)"),
    equipmentType: count(rows, (r) => text(r, "EQP_TY") || "(없음)"),
    paging: Object.fromEntries(
      ["IS_PAGING", "PAGE_INDEX", "PAGE_SIZE", "PAGE_UNIT", "RECORD_COUNT_PER_PAGE", "FIRST_INDEX", "LAST_INDEX", "S_DATE", "E_DATE"].map((k) => [
        k,
        [...new Set(rows.map((r) => text(r, k)))].slice(0, 5),
      ])
    ),
    regionCodes: Object.fromEntries(
      ["SIDO", "SIGUNGU", "S_SIDO"].map((k) => [k, [...new Set(rows.map((r) => text(r, k)))].slice(0, 8)])
    ),
    district: {
      남구: allAddr.filter((a) => a.includes("남구")).length,
      북구: allAddr.filter((a) => a.includes("북구")).length,
      둘다아님: allAddr.filter((a) => !a.includes("남구") && !a.includes("북구")).length,
    },
  };
}

/** 응답의 최상위 구조를 값 없이 형태로만 나타낸다 (예: {"result":"array(120)"}) */
export function describeShape(json: unknown, depth = 0): unknown {
  if (Array.isArray(json)) return `array(${json.length})`;
  if (json === null) return "null";
  if (typeof json === "object") {
    if (depth >= 3) return "object";
    return Object.fromEntries(Object.entries(json as Record<string, unknown>).map(([k, v]) => [k, describeShape(v, depth + 1)]));
  }
  return typeof json;
}
