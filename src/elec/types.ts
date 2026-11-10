/**
 * 한국전기안전공사 전기안전정보공개 OpenAPI 출력항목과, 이 프로젝트가 화면·도구에 내보내는 형태.
 *
 * 출력항목 이름과 설명은 전기안전종합정보시스템 「Open API 소개」 게시물의
 * 출력결과(Response Element) 표를 그대로 옮겼다 (2026-11-05 확인).
 */

/** OpenAPI 서비스 (원문 명세의 "서비스 호출" 값) */
export type KesService = "inspctResultInfo" | "speclCheckInfo" | "dsqlfcSttus";

export const KES_SERVICE_LABELS: Readonly<Record<KesService, string>> = {
  inspctResultInfo: "검사점검이력정보",
  speclCheckInfo: "특별안전점검정보",
  dsqlfcSttus: "부적합현황정보",
};

/**
 * 원문 명세의 출력항목(영문 항목명 기준). 실제 응답의 값 형식(문자/숫자)은 확인되지 않아 모두 unknown으로 받는다.
 * 개인 성명 항목(RPRSNTV 대표자명, INSPTR_NM 검사점검자명, CNSTRCT_ENTRPS_RPRSNTV 시공업체대표자명)은
 * 정규화 단계에서 버리고 화면·도구로 내보내지 않는다.
 */
export const KES_RESPONSE_FIELDS = {
  INSPCT_DIV: "검사점검설비용도구분",
  RCEPT_TY: "검사점검타입",
  INSPCT_ASORT: "검사점검종류",
  EQP_TY: "설비타입",
  CMPNM: "상호명",
  RPRSNTV: "대표자명",
  LNM_ADRES: "지번주소",
  RN_ADRES: "도로명주소",
  PNU_CODE: "법정동코드",
  MHRLS_NO: "호기번호",
  LKMESM_JDNT: "누설판정",
  INDUST_KND: "업종",
  BIZPLC: "사업소",
  TRANSELE_VLTGE: "수전전압",
  TRANSELE_CPCTY: "수전용량",
  GEN_VLTGE: "발전전압",
  GEN_CPCTY: "발전용량",
  VLTGE: "전압(V)",
  CPCTY: "용량(kW)",
  CNSTRCT_ENTRPS: "시공업체",
  CNSTRCT_ENTRPS_RPRSNTV: "시공업체대표자명",
  SAFE_GRAD: "안전등급",
  IMPROPT_CODE: "부적합원인",
  INSPCT_BGNDE: "검사점검시작일",
  INSPCT_ENDDE: "검사점검종료일",
  INSPTR_NM: "검사점검자명",
  INSPCT_RESULT: "검사점검결과",
  CHECK_TYPE: "점검종류(특별안전점검)",
  CHECK_DETAIL_TYPE: "점검종류상세(특별안전점검)",
} as const;

export type KesRawRecord = Record<string, unknown>;

/** 화면·도구로 내보내는 검사 기록 1건 (개인 성명 제외) */
export interface CapacityRecord {
  /** 검사점검설비용도구분 (일반용/자가용/사업용) */
  category: string | null;
  /** 검사점검타입 (예: 사용전검사) */
  inspectionType: string | null;
  /** 검사점검종류 (예: 변압기 변경) */
  inspectionKind: string | null;
  /** 설비타입 (예: 수변전설비) */
  equipmentType: string | null;
  /** 상호명 */
  businessName: string | null;
  /** 지번주소 */
  lotAddress: string | null;
  /** 도로명주소 */
  roadAddress: string | null;
  /** 법정동코드 */
  legalDongCode: string | null;
  /** 호기번호 */
  unitNo: string | null;
  /** 업종 */
  industry: string | null;
  /** 검사점검 사업소 (한국전기안전공사 사업소) */
  office: string | null;
  /** 수전전압 (V) — 단위 근거는 RECEIVING_UNIT_NOTE 참고 */
  receivingVoltageV: number | null;
  /** 수전용량 (kW) — 단위 근거는 RECEIVING_UNIT_NOTE 참고 */
  receivingCapacityKw: number | null;
  /** 발전전압 (V) */
  generationVoltageV: number | null;
  /** 발전용량 (kW) */
  generationCapacityKw: number | null;
  /** 전압(V) — 명세상 항목명 그대로 */
  voltageV: number | null;
  /** 용량(kW) — 명세상 항목명 그대로 */
  capacityKw: number | null;
  /** 원문 값 (가공 전 문자열). 숫자로 읽지 못한 값도 여기서 확인할 수 있다. */
  raw: {
    receivingVoltage: string | null;
    receivingCapacity: string | null;
    generationVoltage: string | null;
    generationCapacity: string | null;
    voltage: string | null;
    capacity: string | null;
  };
  /** 누설판정 */
  leakageJudgement: string | null;
  /** 안전등급 */
  safetyGrade: string | null;
  /** 부적합원인 */
  nonconformityCause: string | null;
  /** 검사점검시작일 */
  inspectionStart: string | null;
  /** 검사점검종료일 */
  inspectionEnd: string | null;
  /** 검사점검결과 */
  result: string | null;
  /** 점검종류(특별안전점검) */
  checkType: string | null;
  /** 점검종류상세(특별안전점검) */
  checkDetailType: string | null;
  /** 이 기록을 받아온 조회연월(YYYYMM) */
  sourceMonth: string;
}

/** 수전전압·수전용량 단위 표기 근거 */
export const RECEIVING_UNIT_NOTE =
  "OpenAPI 명세에는 수전전압·수전용량의 단위가 적혀 있지 않습니다. 한국전기안전공사 전기안전종합정보시스템 " +
  "「검사·점검이력정보」 조회화면이 같은 항목을 '수전 전압(V)', '수전 용량(kW)'으로 표기하고 있어 이에 따라 V·kW로 표시합니다.";
