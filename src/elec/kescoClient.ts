/**
 * 한국전기안전공사 전기안전정보공개 OpenAPI 클라이언트.
 *
 * 원문 명세 (전기안전종합정보시스템 「Open API 소개」, 2026-11-05 확인)
 * - Request URL: https://www.kes.go.kr/openAPI.do   (HTTP GET, HTTP POST / 결과 형식 JSON)
 * - 요청변수(모두 필수): codeNo(인증키), service(서비스명), searchYM(조회연월 YYYYMM), sido(시도코드), gugun(구군코드)
 * - 인증키 오류 응답(실측): {"result":"유효하지않은 코드입니다."}
 *
 * ⚠️ 정상 응답의 전체 구조(목록이 담기는 위치)는 인증키가 없어 실측하지 못했다.
 *   그래서 응답에서 "객체 배열"을 찾아 그 위치(envelopePath)를 함께 돌려주고,
 *   어떤 형태에도 맞지 않으면 응답 앞부분을 보여 주는 오류를 낸다(값을 지어내지 않음).
 */

import type { KesRawRecord, KesService } from "./types.js";

export const KES_OPENAPI_URL = "https://www.kes.go.kr/openAPI.do";

export type KesApiErrorKind = "auth" | "http" | "network" | "format";

export class KesApiError extends Error {
  constructor(
    public readonly kind: KesApiErrorKind,
    message: string
  ) {
    super(message);
    this.name = "KesApiError";
  }
}

export interface KesMonthQuery {
  apiKey: string;
  service: KesService;
  /** 조회연월 YYYYMM */
  searchYM: string;
  sido: string;
  gugun: string;
}

export interface KesMonthResponse {
  records: KesRawRecord[];
  /** 목록이 들어 있던 위치 (예: "$", "result", "response.body.items.item") */
  envelopePath: string | null;
  /** 목록 대신 문자열 안내가 온 경우 그 원문 (예: 자료 없음 안내). 오류인지 여부는 판단하지 않는다. */
  message: string | null;
}

/** 인증키 오류로 판단하는 안내 문구 (실측값: "유효하지않은 코드입니다.") */
const AUTH_ERROR_PATTERN = /유효하지\s*않은\s*코드/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is KesRawRecord[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

/** 응답 안에서 객체 배열을 너비 우선으로 찾는다(깊이 4까지). */
function findRecordArray(root: unknown): { path: string; records: KesRawRecord[] } | null {
  if (isRecordArray(root)) return { path: "$", records: root };
  const queue: Array<{ value: unknown; path: string; depth: number }> = [{ value: root, path: "", depth: 0 }];
  while (queue.length > 0) {
    const { value, path, depth } = queue.shift()!;
    if (!isPlainObject(value) || depth >= 4) continue;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isRecordArray(child)) return { path: childPath, records: child };
      // 목록이 1건일 때 배열 대신 객체 하나로 오는 형식(공공데이터 API에 흔함)은 item 키에 한해 인정
      if (key === "item" && isPlainObject(child)) return { path: childPath, records: [child] };
      queue.push({ value: child, path: childPath, depth: depth + 1 });
    }
  }
  return null;
}

/** 응답 본문(text)을 해석한다. 테스트할 수 있도록 네트워크 호출과 분리했다. */
export function parseKesResponse(text: string): KesMonthResponse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new KesApiError("format", `응답이 JSON 형식이 아닙니다. 응답 앞부분: ${text.slice(0, 200)}`);
  }

  if (isPlainObject(json) && typeof json.result === "string") {
    const message = json.result.trim();
    if (AUTH_ERROR_PATTERN.test(message)) {
      throw new KesApiError("auth", `인증키 오류: ${message} (.env의 KESCO_API_KEY를 확인하십시오)`);
    }
    return { records: [], envelopePath: null, message };
  }

  const found = findRecordArray(json);
  if (found) return { records: found.records, envelopePath: found.path, message: null };

  if (Array.isArray(json) && json.length === 0) return { records: [], envelopePath: "$", message: null };

  throw new KesApiError("format", `응답에서 검사 기록 목록을 찾지 못했습니다. 응답 앞부분: ${text.slice(0, 200)}`);
}

export interface FetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** 한 달치(조회연월 1개) 자료를 받아온다. */
export async function fetchKesMonth(query: KesMonthQuery, options: FetchOptions = {}): Promise<KesMonthResponse> {
  const url = new URL(KES_OPENAPI_URL);
  url.searchParams.set("codeNo", query.apiKey);
  url.searchParams.set("service", query.service);
  url.searchParams.set("searchYM", query.searchYM);
  url.searchParams.set("sido", query.sido);
  url.searchParams.set("gugun", query.gugun);

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "응답 시간 초과" : ((err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message);
    throw new KesApiError(
      "network",
      `전기안전종합정보시스템에 연결하지 못했습니다(${reason}). 사내 프록시를 쓰는 경우 README의 프록시 설정을 확인하십시오.`
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new KesApiError("http", `전기안전종합정보시스템 응답 오류: HTTP ${res.status}. 응답 앞부분: ${text.slice(0, 200)}`);
  }
  return parseKesResponse(text);
}
