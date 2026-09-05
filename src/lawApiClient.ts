/**
 * ⚠️ 미검증: 이 파일이 호출하는 엔드포인트(lawService.do, lawSearch.do)와
 * 파라미터명(OC, target, MST, ID, JO, type)은 국가법령정보센터 오픈API에
 * 대해 일반적으로 알려진 사용법을 기준으로 작성했습니다. 이 개발 환경은
 * law.go.kr 도메인 접속이 네트워크 프록시에서 차단되어 있어 직접 호출해
 * 검증하지 못했습니다.
 *
 * 네트워크가 열린 환경(로컬 PC 등)에서 이 스크립트를 처음 실행할 때는
 * 응답이 실제로 유효한 법령 데이터인지, 혹은 파라미터 오류 안내 메시지인지
 * 반드시 눈으로 확인하세요.
 */

import { requireLawGoKrOc } from "./env.js";
import type { RawLawResponse } from "./lawApiTypes.js";

const BASE_URL = "https://www.law.go.kr/DRF";

export interface FetchLawTextParams {
  /** 법령 마스터 번호(MST). mst 또는 id 중 하나는 반드시 지정 */
  mst?: string;
  /** 법령 ID. mst 또는 id 중 하나는 반드시 지정 */
  id?: string;
  /** 특정 조문만 조회 시 예: "제1조" (미지정 시 전체 조문) */
  jo?: string;
}

async function requestJson<T>(url: URL): Promise<T> {
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API 호출 실패: HTTP ${res.status} ${res.statusText} (${url.toString()})`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "응답이 유효한 JSON이 아닙니다. 엔드포인트/파라미터가 실제 API와 다르거나, " +
        `OC 값이 잘못되었을 수 있습니다. 응답 앞부분: ${text.slice(0, 300)}`
    );
  }
}

/** 국가법령정보센터 오픈API "현행법령 본문 조회" 호출 (원본 JSON 그대로 반환) */
export async function fetchLawText(params: FetchLawTextParams): Promise<RawLawResponse> {
  const oc = requireLawGoKrOc();
  if (!params.mst && !params.id) {
    throw new Error("mst 또는 id 중 하나는 반드시 지정해야 합니다.");
  }

  const url = new URL(`${BASE_URL}/lawService.do`);
  url.searchParams.set("OC", oc);
  url.searchParams.set("target", "law");
  url.searchParams.set("type", "JSON");
  if (params.mst) url.searchParams.set("MST", params.mst);
  if (params.id) url.searchParams.set("ID", params.id);
  if (params.jo) url.searchParams.set("JO", params.jo);

  return requestJson<RawLawResponse>(url);
}

export interface SearchLawParams {
  query: string;
  page?: number;
  display?: number;
}

/** 국가법령정보센터 오픈API 법령 검색 호출 (원본 JSON 그대로 반환, 타입 미정의) */
export async function searchLaw(params: SearchLawParams): Promise<unknown> {
  const oc = requireLawGoKrOc();
  const url = new URL(`${BASE_URL}/lawSearch.do`);
  url.searchParams.set("OC", oc);
  url.searchParams.set("target", "law");
  url.searchParams.set("type", "JSON");
  url.searchParams.set("query", params.query);
  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.display) url.searchParams.set("display", String(params.display));

  return requestJson<unknown>(url);
}
