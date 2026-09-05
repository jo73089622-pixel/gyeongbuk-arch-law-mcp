/**
 * ⚠️ 이 파서는 미검증 스키마(lawApiTypes.ts)를 기준으로 작성된 초안입니다.
 * 실제 국가법령정보센터 오픈API 응답 샘플을 받으면 lawApiTypes.ts와
 * 이 파일의 매핑 로직을 실제 필드명에 맞게 검증/수정해야 합니다.
 */

import type {
  OneOrMany,
  RawCodeContent,
  RawJoHang,
  RawJoHo,
  RawJoMok,
  RawJoMun,
  RawLawResponse,
} from "./lawApiTypes.js";

export interface LawArticleItem {
  label: string;
  content: string;
}

export interface LawArticleSubItem {
  label: string;
  content: string;
  items: LawArticleItem[];
}

export interface LawArticleParagraph {
  label: string;
  content: string;
  subItems: LawArticleSubItem[];
}

export interface LawArticle {
  key?: string;
  number?: string;
  branchNumber?: string;
  title?: string;
  content?: string;
  effectiveDate?: string;
  paragraphs: LawArticleParagraph[];
}

export interface ParsedLaw {
  lawId?: string;
  lawName?: string;
  promulgationDate?: string;
  promulgationNumber?: string;
  effectiveDate?: string;
  ministry?: string;
  lawType?: string;
  articles: LawArticle[];
}

/** API가 항목 1개일 때 배열을 생략하고 단일 객체로 주는 경우를 대비해 항상 배열로 정규화한다 */
function toArray<T>(value: OneOrMany<T>): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function extractCodeContent(value: RawCodeContent | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return value.content;
}

function parseMok(raw: RawJoMok): LawArticleItem {
  return {
    label: raw.목번호 ?? "",
    content: raw.목내용 ?? "",
  };
}

function parseHo(raw: RawJoHo): LawArticleSubItem {
  return {
    label: raw.호번호 ?? "",
    content: raw.호내용 ?? "",
    items: toArray(raw.목?.목단위).map(parseMok),
  };
}

function parseHang(raw: RawJoHang): LawArticleParagraph {
  return {
    label: raw.항번호 ?? "",
    content: raw.항내용 ?? "",
    subItems: toArray(raw.호?.호단위).map(parseHo),
  };
}

function parseJoMun(raw: RawJoMun): LawArticle {
  return {
    key: raw.조문키,
    number: raw.조문번호,
    branchNumber: raw.조문가지번호,
    title: raw.조문제목,
    content: raw.조문내용,
    effectiveDate: raw.조문시행일자,
    paragraphs: toArray(raw.항?.항단위).map(parseHang),
  };
}

/**
 * 국가법령정보센터 오픈API "현행법령 본문 조회" JSON 응답을
 * 내부에서 다루기 쉬운 구조로 변환한다.
 *
 * ⚠️ 미검증: 실제 응답으로 확인 후 매핑을 조정할 것.
 */
export function parseLawApiResponse(raw: RawLawResponse): ParsedLaw {
  const basicInfo = raw.법령?.기본정보;

  return {
    lawId: basicInfo?.법령ID,
    lawName: basicInfo?.법령명_한글,
    promulgationDate: basicInfo?.공포일자,
    promulgationNumber: basicInfo?.공포번호,
    effectiveDate: basicInfo?.시행일자,
    ministry: extractCodeContent(basicInfo?.소관부처),
    lawType: extractCodeContent(basicInfo?.법종구분),
    articles: toArray(raw.법령?.조문?.조문단위).map(parseJoMun),
  };
}
