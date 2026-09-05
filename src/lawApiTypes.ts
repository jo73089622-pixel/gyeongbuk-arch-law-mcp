/**
 * ⚠️ 미검증 스키마 (UNVERIFIED)
 *
 * 이 파일의 타입은 국가법령정보센터 오픈API(law.go.kr, open.law.go.kr)의
 * "현행법령 본문 조회" JSON 응답 구조에 대한 일반적으로 알려진 형태를
 * "가정"한 것이며, 실제 API 응답으로 검증되지 않았습니다.
 *
 * 실제 샘플 JSON을 확보하면 이 파일의 필드명/구조를 반드시 그 응답과
 * 대조하여 수정해야 합니다. (예: 키 이름, 배열/단일객체 여부,
 * 소관부처처럼 code+content로 오는 필드의 실제 형태 등)
 */

/** 항목이 1개일 때 배열이 아닌 단일 객체로 오는 경우가 흔하다고 알려져 있음 (미검증) */
export type OneOrMany<T> = T | T[] | undefined;

export interface RawJoMok {
  목번호?: string;
  목내용?: string;
}

export interface RawJoHo {
  호번호?: string;
  호내용?: string;
  목?: { 목단위?: OneOrMany<RawJoMok> };
}

export interface RawJoHang {
  항번호?: string;
  항내용?: string;
  호?: { 호단위?: OneOrMany<RawJoHo> };
}

export interface RawJoMun {
  조문키?: string;
  조문번호?: string;
  조문가지번호?: string;
  조문제목?: string;
  조문내용?: string;
  조문시행일자?: string;
  항?: { 항단위?: OneOrMany<RawJoHang> };
}

/** 코드+텍스트 쌍으로 오는 필드(소관부처, 법종구분 등)의 흔한 형태 (미검증) */
export interface RawCodeContent {
  content?: string;
  코드?: string;
}

export interface RawLawBasicInfo {
  법령명_한글?: string;
  법령ID?: string;
  공포일자?: string;
  공포번호?: string;
  시행일자?: string;
  소관부처?: RawCodeContent | string;
  법종구분?: RawCodeContent | string;
}

export interface RawLawResponse {
  법령?: {
    기본정보?: RawLawBasicInfo;
    조문?: { 조문단위?: OneOrMany<RawJoMun> };
  };
}
