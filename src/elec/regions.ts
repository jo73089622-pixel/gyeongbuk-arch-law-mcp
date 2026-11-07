/**
 * 한국전기안전공사 전기안전정보공개 OpenAPI(https://www.kes.go.kr/openAPI.do)에 넘길
 * 시도코드(sido)·구군코드(gugun)를 다룬다.
 *
 * 근거 (2026-11-05 확인)
 * - 시도코드: 전기안전종합정보시스템 「검사·점검이력정보」 조회화면의 시도 선택값.
 *   강원특별자치도는 42, 전북특별자치도는 45로 쓰고 있다(현행 법정동코드 51·52와 다름).
 * - 구군코드: OpenAPI 명세의 호출 예시(sido=45, gugun=71 → 전북 완주군, 법정동 시군구코드 45710)에
 *   따라 시군구코드 5자리 중 3~4번째 자리(2자리)를 사용한다.
 * - 경상북도 시군구코드: 국토교통부 건축HUB 법정동코드.
 *
 * 실측(2026-11-07, 2026년 10월분): gugun=11 은 포항시 남구·북구 기록을 함께 돌려주고(남구 130·북구 101건),
 *   3자리(111·113)는 0건이었다. 그래서 포항시(47110)로 조회한 뒤 구는 주소 글자로 거른다.
 */

export interface KesSido {
  /** 전기안전종합정보시스템이 쓰는 시도코드(2자리) */
  code: string;
  name: string;
}

/** 전기안전종합정보시스템 「검사·점검이력정보」 화면의 시도 선택값 */
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

export interface Sigungu {
  /** 법정동 시군구코드 5자리 */
  code: string;
  name: string;
  sidoName: string;
  /** 조회 시 유의사항 */
  note?: string;
}

/** 경상북도 22개 시군 (국토교통부 건축HUB 법정동코드, 2026-11-05 확인) */
export const GYEONGBUK_SIGUNGU: readonly Sigungu[] = [
  {
    code: "47110",
    name: "포항시",
    sidoName: "경상북도",
    note: "남구·북구를 함께 조회합니다(실측: API는 구 단위 코드를 받지 않음). 구만 보려면 '포항시 남구'처럼 입력하면 주소로 거릅니다.",
  },
  { code: "47130", name: "경주시", sidoName: "경상북도" },
  { code: "47150", name: "김천시", sidoName: "경상북도" },
  { code: "47170", name: "안동시", sidoName: "경상북도" },
  { code: "47190", name: "구미시", sidoName: "경상북도" },
  { code: "47210", name: "영주시", sidoName: "경상북도" },
  { code: "47230", name: "영천시", sidoName: "경상북도" },
  { code: "47250", name: "상주시", sidoName: "경상북도" },
  { code: "47280", name: "문경시", sidoName: "경상북도" },
  { code: "47290", name: "경산시", sidoName: "경상북도" },
  { code: "47730", name: "의성군", sidoName: "경상북도" },
  { code: "47750", name: "청송군", sidoName: "경상북도" },
  { code: "47760", name: "영양군", sidoName: "경상북도" },
  { code: "47770", name: "영덕군", sidoName: "경상북도" },
  { code: "47820", name: "청도군", sidoName: "경상북도" },
  { code: "47830", name: "고령군", sidoName: "경상북도" },
  { code: "47840", name: "성주군", sidoName: "경상북도" },
  { code: "47850", name: "칠곡군", sidoName: "경상북도" },
  { code: "47900", name: "예천군", sidoName: "경상북도" },
  { code: "47920", name: "봉화군", sidoName: "경상북도" },
  { code: "47930", name: "울진군", sidoName: "경상북도" },
  { code: "47940", name: "울릉군", sidoName: "경상북도" },
];

/** 포항시 구 단위 코드는 시 단위(47110)로 조회하고, 구는 주소 글자로 거른다. */
const SIGUNGU_ALIASES: Readonly<Record<string, { code: string; district: string }>> = {
  "47111": { code: "47110", district: "남구" },
  "47113": { code: "47110", district: "북구" },
};

export interface KesRegion {
  sido: string;
  gugun: string;
}

export interface ResolvedRegion extends KesRegion {
  /** 조회에 쓰는 시군구코드 5자리 */
  code: string;
  /** 화면 표시용 이름 */
  name: string;
  note?: string;
  /** 경상북도 목록에 있는 지역인지 (아니면 코드 직접 입력) */
  listed: boolean;
  /** 구 단위 조회(예: 포항시 남구) — 주소에 이 글자가 있는 기록만 남긴다 */
  district?: string;
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

/** 법정동 시군구코드 5자리를 전기안전종합정보시스템 OpenAPI의 sido·gugun으로 바꾼다. */
export function toKesRegion(sigunguCode: string): KesRegion {
  if (!/^\d{5}$/.test(sigunguCode)) {
    throw new Error(`시군구코드는 숫자 5자리여야 합니다: ${sigunguCode}`);
  }
  const sidoPart = sigunguCode.slice(0, 2);
  const sido = SIDO_CODE_TO_KES[sidoPart] ?? sidoPart;
  if (!KES_SIDO.some((s) => s.code === sido)) {
    throw new Error(`전기안전종합정보시스템 시도코드 목록에 없는 코드입니다: ${sidoPart}`);
  }
  return { sido, gugun: sigunguCode.slice(2, 4) };
}

/**
 * 사용자가 입력한 지역(시군구 이름 또는 5자리 코드)을 조회용 지역으로 바꾼다.
 * - "구미시", "구미", "경북 구미시", "경상북도 구미시", "47190" 모두 허용
 * - 경상북도 외 지역은 5자리 시군구코드로만 받는다.
 * 찾지 못하면 undefined를 돌려준다(추측하지 않음).
 */
export function resolveSigungu(input: string): ResolvedRegion | undefined {
  const raw = input.trim();
  if (!raw) return undefined;

  if (/^\d{5}$/.test(raw)) {
    const alias = SIGUNGU_ALIASES[raw];
    const code = alias?.code ?? raw;
    const listed = GYEONGBUK_SIGUNGU.find((s) => s.code === code);
    let kes: KesRegion;
    try {
      kes = toKesRegion(code);
    } catch {
      return undefined; // 전기안전종합정보시스템 시도코드 목록에 없는 코드
    }
    if (listed) {
      const district = alias?.district;
      return {
        ...kes,
        code,
        name: `${listed.sidoName} ${listed.name}${district ? ` ${district}` : ""}`,
        note: listed.note,
        listed: true,
        ...(district ? { district } : {}),
      };
    }
    const sidoName = KES_SIDO.find((s) => s.code === kes.sido)?.name ?? "";
    return {
      ...kes,
      code,
      name: `${sidoName} (시군구코드 ${code})`.trim(),
      note: "경상북도 목록 밖의 코드입니다. 코드가 맞는지 국가 법정동코드로 확인하십시오.",
      listed: false,
    };
  }

  const stripped = compact(raw).replace(/^(경상북도|경북)/, "");
  const districtMatch = stripped.match(/(남구|북구)$/);
  const text = stripped.replace(/(남구|북구)$/, "");
  if (!text) return undefined;
  const match = GYEONGBUK_SIGUNGU.find((s) => {
    const full = compact(s.name);
    const short = full.replace(/[시군]$/, "");
    return text === full || text === short;
  });
  if (!match) return undefined;
  const district = match.code === "47110" ? districtMatch?.[1] : undefined;
  return {
    ...toKesRegion(match.code),
    code: match.code,
    name: `${match.sidoName} ${match.name}${district ? ` ${district}` : ""}`,
    note: match.note,
    listed: true,
    ...(district ? { district } : {}),
  };
}
