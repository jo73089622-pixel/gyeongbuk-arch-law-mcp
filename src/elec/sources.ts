/**
 * 화면·MCP 도구·챗봇이 함께 쓰는 출처·법적 근거·자료 한계 안내문.
 * 법령 조문은 국가법령정보센터 현행 원문(2026-11-05 조회)과 대조했다.
 */

export const OFFICIAL_LOOKUP_URL = "https://www.kes.go.kr/web/lay1/program/S1T113C118/PI/result/inspctResultInfo.do";
export const OPENAPI_INTRO_URL = "https://www.kes.go.kr/web/lay1/bbs/S1T268C269/E/85/list.do";
export const OPENAPI_APPLY_URL = "https://www.kes.go.kr/web/lay1/program/S1T268C270/PI/openAPI/reqstOpenAPI.do";
export const DATA_GO_KR_URL = "https://www.data.go.kr/data/15146770/openapi.do";

export const LEGAL_BASIS: readonly string[] = [
  "「전기안전관리법」 제21조제1항: 기후에너지환경부장관 또는 시·도지사는 전기설비의 검사 및 점검 결과 등 전기안전관리에 관한 정보를 제38조의 전기안전종합정보시스템에 공개할 수 있다.",
  "「전기안전관리법 시행령」 제10조: 공개할 수 있는 정보에 제1호 상호명·소재지, 제2호 '전기설비 현황(수전설비 및 발전설비의 전압 및 용량)', 제3호 검사·점검 연월일 및 결과가 포함된다.",
  "「전기안전관리법」 제9조(사용전검사), 제11조제1항(정기검사): 검사 기록의 근거.",
  "「전기안전관리법 시행규칙」 제8조제1항 및 별표 4 제2호 나목: 고압 이상 전기수용설비의 정기검사는 2년마다 또는 3년마다(각 전후 2개월), 일부는 4년 이내에 받는다.",
];

export const DATA_SOURCE_LINES: readonly string[] = [
  "자료: 한국전기안전공사 「전기안전정보공개 OpenAPI」 중 검사점검이력정보(inspctResultInfo). 공공데이터포털 등록명 「한국전기안전공사_전기안전정보공개 API」(15146770, 제공형태 LINK, 갱신 실시간).",
  "조회 단위: 원문 명세상 조회연월(YYYYMM)과 시도·구군코드로만 조회된다. 상호·주소 검색은 받아온 자료를 이 프로그램이 걸러 낸 결과이다.",
  "개인 성명(대표자명·검사점검자명·시공업체 대표자명)과 시공업체명은 수전용량 확인 목적과 무관하여 표시하지 않는다.",
];

export const LIMITATIONS: readonly string[] = [
  "정보 공개는 재량 규정('공개할 수 있다')이므로 모든 시설이 수록되었다고 볼 수 없다.",
  "조회 기간 안에 검사·점검 기록이 없는 시설은 나타나지 않는다.",
  "이 결과는 참고용이며, 공식 확인은 한국전기안전공사 또는 전기안전종합정보시스템에서 해야 한다.",
];

/** 인증키가 없어 실제 응답으로 확인하지 못한 사항 (확인되면 지운다) */
export const UNVERIFIED_ITEMS: readonly string[] = [
  "응답의 상호명이 일부 가려져(마스킹) 나오는지 여부 (명세 예시의 대표자명·검사점검자명은 가려져 있음)",
  "응답 주소에 번지·건물번호가 들어 있는지 여부 (명세 예시는 '전북 완주군 봉동읍 둔산리'처럼 번지가 없음)",
  "포항시 남구·북구를 구분해 조회할 수 있는지 여부 (명세 예시의 구군코드는 2자리)",
  "정상 응답의 목록 구조와 1회 응답 건수 (명세에 페이지 나눔 변수가 없음)",
];
