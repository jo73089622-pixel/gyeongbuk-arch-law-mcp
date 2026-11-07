/**
 * 전국 시도·시군구를 한국전기안전공사 전기안전정보공개 OpenAPI(https://www.kes.go.kr/openAPI.do)의
 * 시도코드(sido)·구군코드(gugun)로 바꾼다.
 *
 * 근거
 * - 지역 목록: 국토교통부 법정동코드(regionData.ts 상단의 출처, '존재' 코드만).
 * - 시도코드: 전기안전종합정보시스템 「검사·점검이력정보」 조회화면의 시도 선택값(2026-11-05 확인).
 *   강원특별자치도 42, 전북특별자치도 45, 광주광역시 29, 전라남도 46 을 쓰고 있어 현행 법정동코드(51·52·12)와 다르다.
 * - 구군코드: OpenAPI 명세 예시(sido=45, gugun=71 → 45710)에 따라 시군구코드 3~4번째 자리.
 * - 실측(2026-11-07): 경상북도(구미·포항)는 이 규칙대로 조회됐다. 포항시는 gugun=11 로 남구·북구가 함께 오고
 *   3자리 구 코드는 0건이어서, 시 아래 구는 시 코드로 조회한 뒤 주소로 거른다.
 *
 * ⚠️ 실제 응답으로 아직 확인하지 못한 대응(지역 유의사항으로 표시): 전남광주통합특별시의 옛 코드 대응,
 *   강원·전북의 42·45 대응, 2026년 인천 구 개편 지역, 포항 외의 '구가 있는 시', 코드 5번째 자리가 0이 아닌 지역.
 *   `npm run kesco:verify -- --regions` 로 확인한다.
 */

import { REGION_SOURCE, SIDO_ROWS, SIGUNGU_ROWS, type SigunguRow } from "./regionData.js";

export { REGION_SOURCE };

export interface KesSido {
  /** 전기안전종합정보시스템이 쓰는 시도코드(2자리) */
  code: string;
  name: string;
}

/** 전기안전종합정보시스템 「검사·점검이력정보」 화면의 시도 선택값 (2026-11-05 확인) */
export const KES_SIDO: readonly KesSido[] = [
  { code: "11", name: "서울특별시" },
  { code: "26", name: "부산광역시" },
  { code: "27", name: "대구광역시" },
  { code: "28", name: "인천광역시" },
  { code: "29", name: "광주광역시" },
  { code: "30", name: "대전광역시" },
  { code: "31", name: "울산광역시" },
  { code: "36", name: "세종특별자치시" },
  { code: "41", name: "경기도" },
  { code: "42", name: "강원특별자치도" },
  { code: "43", name: "충청북도" },
  { code: "44", name: "충청남도" },
  { code: "45", name: "전북특별자치도" },
  { code: "46", name: "전라남도" },
  { code: "47", name: "경상북도" },
  { code: "48", name: "경상남도" },
  { code: "50", name: "제주특별자치도" },
];

/** 현행 법정동 시도코드 → 전기안전종합정보시스템 시도코드 (화면 선택값 기준) */
const SIDO_CODE_TO_KES: Readonly<Record<string, string>> = {
  "51": "42", // 강원특별자치도
  "52": "45", // 전북특별자치도
};

/** 시도 이름 별칭 → 현행 시도코드 */
const SIDO_ALIASES: Readonly<Record<string, string>> = {
  서울: "11", 서울시: "11", 서울특별시: "11",
  부산: "26", 부산시: "26", 부산광역시: "26",
  대구: "27", 대구시: "27", 대구광역시: "27",
  인천: "28", 인천시: "28", 인천광역시: "28",
  광주: "12", 광주시: "12", 광주광역시: "12", 전남: "12", 전라남도: "12", 전남광주: "12", 전남광주통합특별시: "12",
  대전: "30", 대전시: "30", 대전광역시: "30",
  울산: "31", 울산시: "31", 울산광역시: "31",
  세종: "36", 세종시: "36", 세종특별자치시: "36",
  경기: "41", 경기도: "41",
  강원: "51", 강원도: "51", 강원특별자치도: "51",
  충북: "43", 충청북도: "43",
  충남: "44", 충청남도: "44",
  전북: "52", 전라북도: "52", 전북특별자치도: "52",
  경북: "47", 경상북도: "47",
  경남: "48", 경상남도: "48",
  제주: "50", 제주도: "50", 제주특별자치도: "50",
};

const INCHEON_REORGANIZED = new Set(["28125", "28155", "28275", "28290"]); // 2026년 개편으로 새로 생긴 구

const sidoName = (code: string) => SIDO_ROWS.find((s) => s.code === code)?.name ?? code;
const byCode = new Map(SIGUNGU_ROWS.map((r) => [r.code, r]));

export interface Sigungu {
  /** 현행 법정동 시군구코드 5자리 */
  code: string;
  /** 시도를 뺀 이름 (예: 수원시 장안구) */
  name: string;
  sidoCode: string;
  sidoName: string;
  /** 시 아래 구이면 true */
  isDistrict: boolean;
  note?: string;
}

function noteFor(row: SigunguRow): string | undefined {
  const notes: string[] = [];
  if (row.parent && row.parent !== "47110") {
    notes.push("구 단위로는 조회되지 않을 것으로 보아(포항 실측) 시 전체를 받은 뒤 주소로 구를 거릅니다. 이 시에서는 아직 실제 응답으로 확인하지 않았습니다.");
  }
  if (row.parent === "47110" || row.code === "47110") {
    notes.push("포항시는 남구·북구가 함께 조회됩니다(실측). 구를 고르면 주소로 거릅니다.");
  }
  if (row.legacy) notes.push(`전기안전종합정보시스템의 옛 코드(${row.legacy})로 조회합니다. 실제 응답으로 아직 확인하지 않았습니다.`);
  if (row.sido === "51" || row.sido === "52") notes.push("전기안전종합정보시스템 시도코드(강원 42·전북 45)로 바꿔 조회합니다. 실제 응답으로 아직 확인하지 않았습니다.");
  if (INCHEON_REORGANIZED.has(row.code)) notes.push("2026년 인천 행정구역 개편으로 새로 생긴 구입니다. 공사 시스템 반영 여부를 아직 확인하지 않았습니다.");
  return notes.length ? notes.join(" ") : undefined;
}

function toSigungu(row: SigunguRow): Sigungu {
  return {
    code: row.code,
    name: row.name,
    sidoCode: row.sido,
    sidoName: sidoName(row.sido),
    isDistrict: Boolean(row.parent),
    note: noteFor(row),
  };
}

export const ALL_SIGUNGU: readonly Sigungu[] = SIGUNGU_ROWS.map(toSigungu);
export const SIDO_LIST: readonly { code: string; name: string }[] = SIDO_ROWS;

export function listSigungu(sidoCode: string): Sigungu[] {
  return ALL_SIGUNGU.filter((s) => s.sidoCode === sidoCode);
}

/** 경상북도 22개 시군 (구 제외) */
export const GYEONGBUK_SIGUNGU: readonly Sigungu[] = listSigungu("47").filter((s) => !s.isDistrict);

/** 시도 이름·코드를 현행 시도코드로 */
export function resolveSido(input: string): string | undefined {
  const t = input.replace(/\s+/g, "");
  if (/^\d{2}$/.test(t)) return SIDO_ROWS.some((s) => s.code === t) ? t : undefined;
  return SIDO_ALIASES[t];
}

export interface KesRegion {
  sido: string;
  gugun: string;
}

export interface ResolvedRegion extends KesRegion {
  /** 조회에 쓰는 현행 시군구코드 5자리 (구는 소속 시의 코드) */
  code: string;
  /** 고른 지역의 현행 시군구코드 */
  sigunguCode: string;
  /** 화면 표시용 이름 (예: 경기도 수원시 장안구) */
  name: string;
  note?: string;
  /** 목록에 있는 지역인지 */
  listed: boolean;
  /** 구 단위 조회 — 주소에 이 글자가 있는 기록만 남긴다 */
  district?: string;
}

/** 현행 시군구코드 5자리를 전기안전종합정보시스템 OpenAPI의 sido·gugun으로 바꾼다. */
export function toKesRegion(sigunguCode: string): KesRegion {
  if (!/^\d{5}$/.test(sigunguCode)) {
    throw new Error(`시군구코드는 숫자 5자리여야 합니다: ${sigunguCode}`);
  }
  const row = byCode.get(sigunguCode);
  const effective = row?.legacy ?? sigunguCode;
  const sidoPart = effective.slice(0, 2);
  const sido = SIDO_CODE_TO_KES[sidoPart] ?? sidoPart;
  if (!KES_SIDO.some((s) => s.code === sido)) {
    throw new Error(`전기안전종합정보시스템 시도코드 목록에 없는 코드입니다: ${sidoPart}`);
  }
  return { sido, gugun: effective.slice(2, 4) };
}

function resolvedFrom(row: SigunguRow): ResolvedRegion {
  const queryRow = row.parent ? byCode.get(row.parent)! : row;
  const district = row.parent ? row.name.split(" ").at(-1) : undefined;
  return {
    ...toKesRegion(queryRow.code),
    code: queryRow.code,
    sigunguCode: row.code,
    name: `${sidoName(row.sido)} ${row.name}`,
    note: noteFor(row),
    listed: true,
    ...(district ? { district } : {}),
  };
}

const compact = (s: string) => s.replace(/\s+/g, "");

/** 이름 맞춤용 별칭: "수원시 장안구" → 수원시장안구, 수원장안구 / "구미시" → 구미시, 구미 */
function aliasesOf(row: SigunguRow): string[] {
  const parts = row.name.split(" ");
  const out = new Set<string>([compact(row.name)]);
  if (parts.length === 2) out.add(parts[0].replace(/시$/, "") + parts[1]);
  if (parts.length === 1 && /[시군]$/.test(row.name) && row.name.length > 2) out.add(row.name.slice(0, -1));
  return [...out];
}

export type RegionLookup = { region: ResolvedRegion } | { candidates: string[] } | { notFound: true };

/**
 * 지역 이름(예: "경기 수원시 장안구", "구미시", "서울 중구") 또는 5자리 시군구코드를 찾는다.
 * 이름이 여러 시도에 있으면(예: "중구") 후보를 돌려주고 추측하지 않는다.
 */
export function lookupRegion(input: string): RegionLookup {
  const raw = input.trim();
  if (!raw) return { notFound: true };

  if (/^\d{5}$/.test(raw)) {
    const row = byCode.get(raw);
    return row ? { region: resolvedFrom(row) } : { notFound: true };
  }

  let text = compact(raw);
  let sido: string | undefined;
  const prefixes = Object.keys(SIDO_ALIASES).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (text.startsWith(p) && text.length > p.length) {
      sido = SIDO_ALIASES[p];
      text = text.slice(p.length);
      break;
    }
  }
  if (!sido && SIDO_ALIASES[text] === "36") sido = "36";

  const pool = SIGUNGU_ROWS.filter((r) => !sido || r.sido === sido);
  let matches = pool.filter((r) => aliasesOf(r).includes(text));
  if (sido === "36" && matches.length === 0) matches = pool;
  if (matches.length === 1) return { region: resolvedFrom(matches[0]) };
  if (matches.length > 1) return { candidates: matches.map((r) => `${sidoName(r.sido)} ${r.name}`) };
  return { notFound: true };
}

/** 하나로 정해질 때만 지역을 돌려준다 (여러 후보이거나 없으면 undefined). */
export function resolveSigungu(input: string): ResolvedRegion | undefined {
  const r = lookupRegion(input);
  return "region" in r ? r.region : undefined;
}
