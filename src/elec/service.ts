/**
 * 수전설비 용량 검색 서비스 (MCP 도구·웹 화면·챗봇이 함께 쓴다).
 *
 * 원문 명세상 OpenAPI는 '조회연월 + 시도·구군' 단위로만 조회되므로,
 * ① 지정한 시군구의 최근 N개월 자료를 한 달씩 받아(저장소에 있으면 저장본 사용)
 * ② 설비용도구분·상호·주소 검색어로 걸러 내고
 * ③ 검사일이 최근인 순으로 정리한다.
 * 받은 값은 가공하지 않고 옮기며, 자료가 없으면 빈 결과를 돌려준다(추정값 생성 없음).
 */

import { DEFAULT_CACHE_DIR, isCacheFresh, readCache, writeCache } from "./cache.js";
import { fetchKesMonth, KesApiError, type KesMonthQuery, type KesMonthResponse } from "./kescoClient.js";
import { normalizeRecord } from "./normalize.js";
import { lookupRegion, type ResolvedRegion } from "./regions.js";
import { LEGAL_BASIS, LIMITATIONS, OFFICIAL_LOOKUP_URL, UNVERIFIED_ITEMS } from "./sources.js";
import { RECEIVING_UNIT_NOTE, type CapacityRecord, type KesRawRecord, type KesService } from "./types.js";

export const CATEGORY_OPTIONS = ["자가용", "사업용", "일반용", "전체"] as const;
export type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

export const MIN_MONTHS = 1;
export const MAX_MONTHS = 60;
export const FALLBACK_DEFAULT_MONTHS = 38;
export const DEFAULT_LIMIT = 100;
/**
 * 검색 화면·CSV 내려받기의 최대 건수. 사용자 요청으로 500 → 5,000(2026-11-07) → 20,000(2026-11-10) 상향.
 * AI 도우미(최대 5,000건)와 MCP 도구(최대 5,000건)는 각자의 입력 검사로 따로 제한한다.
 */
export const MAX_LIMIT = 20000;

const SERVICE: KesService = "inspctResultInfo";

export class SearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}

export interface SearchParams {
  /** 시군구 이름(예: 구미시) 또는 5자리 시군구코드(예: 47190) */
  sigungu: string;
  /** 상호·주소 검색어 (공백으로 나눈 낱말을 모두 포함하는 기록만) */
  keyword?: string;
  /** 최근 몇 개월을 조회할지 (이번 달 포함) */
  months?: number;
  category?: CategoryOption;
  /** 같은 상호·주소·호기번호의 기록은 검사일이 가장 최근인 1건만 */
  latestOnly?: boolean;
  /** 저장본을 쓰지 않고 다시 받기 */
  refresh?: boolean;
  /** 돌려줄 최대 건수 */
  limit?: number;
}

export interface SearchProgress {
  done: number;
  total: number;
  month: string;
  source: "cache" | "api" | "message" | "failed";
}

export interface SearchDeps {
  apiKey?: string;
  cacheDir?: string;
  now?: Date;
  /** 실제 호출 사이 대기시간(ms) */
  delayMs?: number;
  fetchMonth?: (query: KesMonthQuery) => Promise<KesMonthResponse>;
  onProgress?: (progress: SearchProgress) => void;
  signal?: AbortSignal;
}

export interface SearchResult {
  region: ResolvedRegion;
  service: KesService;
  period: { from: string; to: string; months: number };
  query: { keyword: string | null; category: CategoryOption; latestOnly: boolean; limit: number };
  counts: {
    fetchedRecords: number;
    /** 구분 필터를 적용할 때 설비용도구분 값이 없어 제외된 기록 수 */
    uncategorizedExcluded: number;
    /** 구분·검색어 조건에 맞은 기록 수 */
    matchedRecords: number;
    /** '최신 1건만' 적용 후 기록 수 (적용하지 않으면 matchedRecords와 같음) */
    distinctRecords: number;
    returnedRecords: number;
    truncated: boolean;
    monthsFromCache: number;
    monthsFromApi: number;
  };
  /** 목록 대신 안내 문구가 온 달 (원문 그대로) */
  monthMessages: Array<{ month: string; message: string }>;
  /** 연결·응답 오류로 받지 못한 달 */
  failedMonths: Array<{ month: string; error: string }>;
  /** 응답에서 목록을 찾은 위치 (실제 응답 구조 확인용) */
  envelopePaths: string[];
  records: CapacityRecord[];
  notes: string[];
  generatedAt: string;
}

export function defaultMonths(): number {
  const n = Number(process.env.KESCO_DEFAULT_MONTHS);
  return Number.isInteger(n) && n >= MIN_MONTHS && n <= MAX_MONTHS ? n : FALLBACK_DEFAULT_MONTHS;
}

function defaultDelayMs(): number {
  const n = Number(process.env.KESCO_REQUEST_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/** 한국 시간 기준 이번 달부터 거꾸로 N개월 (최근 달이 앞) */
export function recentMonthsKst(now: Date, months: number): string[] {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const baseYear = kst.getUTCFullYear();
  const baseMonth = kst.getUTCMonth(); // 0~11
  const list: string[] = [];
  for (let i = 0; i < months; i += 1) {
    const total = baseYear * 12 + baseMonth - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    list.push(`${y}${String(m).padStart(2, "0")}`);
  }
  return list;
}

export function formatMonth(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}

function compactLower(text: string | null): string {
  return (text ?? "").replace(/\s+/g, "").toLowerCase();
}

function sortKey(r: CapacityRecord): string {
  return r.inspectionEnd ?? r.inspectionStart ?? formatMonth(r.sourceMonth);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("조회가 취소되었습니다.", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("조회가 취소되었습니다.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export async function searchReceivingCapacity(params: SearchParams, deps: SearchDeps = {}): Promise<SearchResult> {
  const lookup = lookupRegion(params.sigungu ?? "");
  if ("candidates" in lookup) {
    throw new SearchInputError(
      `'${params.sigungu}'에 해당하는 지역이 여러 곳입니다: ${lookup.candidates.join(", ")}. 시도 이름을 붙여 다시 입력하십시오(예: 서울 중구).`
    );
  }
  if (!("region" in lookup)) {
    throw new SearchInputError(
      `지역을 찾지 못했습니다: '${params.sigungu}'. 시도와 시군구 이름(예: 경북 구미시, 경기 수원시 장안구) 또는 5자리 시군구코드(예: 47190)를 입력하십시오.`
    );
  }
  const region = lookup.region;

  const months = clampInt(params.months, MIN_MONTHS, MAX_MONTHS, defaultMonths());
  const limit = clampInt(params.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const category: CategoryOption = params.category ?? "자가용";
  const latestOnly = params.latestOnly ?? true;
  const keyword = params.keyword?.trim() ? params.keyword.trim() : null;

  const now = deps.now ?? new Date();
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
  const delayMs = deps.delayMs ?? defaultDelayMs();
  const apiKey = deps.apiKey ?? process.env.KESCO_API_KEY ?? "";
  const fetchMonth = deps.fetchMonth ?? ((q: KesMonthQuery) => fetchKesMonth(q));

  const monthList = recentMonthsKst(now, months);
  const previousMonth = recentMonthsKst(now, 2)[1];

  const all: CapacityRecord[] = [];
  const monthMessages: SearchResult["monthMessages"] = [];
  const failedMonths: SearchResult["failedMonths"] = [];
  const envelopePaths = new Set<string>();
  let monthsFromCache = 0;
  let monthsFromApi = 0;
  let apiCalls = 0;

  for (let i = 0; i < monthList.length; i += 1) {
    const month = monthList[i];
    if (deps.signal?.aborted) throw new DOMException("조회가 취소되었습니다.", "AbortError");
    const sources: SearchProgress["source"][] = [];
    // 같은 달을 여러 코드로 조회할 때(행정구역 개편 지역) 똑같은 기록은 한 번만 담는다.
    const seen = new Set<string>();
    const add = (records: KesRawRecord[]) => {
      for (const r of records) {
        const k = JSON.stringify(r);
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(normalizeRecord(r, month));
      }
    };

    for (const q of region.queries) {
      const key = { service: SERVICE, sido: q.sido, gugun: q.gugun, month };
      const cached = params.refresh ? null : await readCache(cacheDir, key);
      if (cached && isCacheFresh(cached, month, previousMonth, now)) {
        add(cached.records);
        if (cached.envelopePath) envelopePaths.add(cached.envelopePath);
        sources.push("cache");
        continue;
      }
      if (!apiKey) {
        throw new KesApiError(
          "auth",
          "인증키(KESCO_API_KEY)가 설정되지 않았습니다. 전기안전종합정보시스템에서 OpenAPI 인증키를 발급받아 .env 파일에 넣으십시오."
        );
      }
      if (apiCalls > 0 && delayMs > 0) await sleep(delayMs, deps.signal);
      apiCalls += 1;
      try {
        const res = await fetchMonth({ apiKey, service: SERVICE, searchYM: month, sido: q.sido, gugun: q.gugun });
        if (res.message !== null) {
          monthMessages.push({ month: formatMonth(month), message: res.message });
          sources.push("message");
        } else {
          await writeCache(cacheDir, key, { fetchedAt: now.toISOString(), envelopePath: res.envelopePath, records: res.records });
          add(res.records);
          if (res.envelopePath) envelopePaths.add(res.envelopePath);
          sources.push("api");
        }
      } catch (err) {
        // 인증키 오류·응답 형식 오류는 모든 달에 똑같이 생기므로 즉시 멈춘다.
        if (err instanceof KesApiError && (err.kind === "auth" || err.kind === "format")) throw err;
        if ((err as Error).name === "AbortError") throw err;
        failedMonths.push({ month: formatMonth(month), error: `[${q.sido}-${q.gugun}] ${(err as Error).message}` });
        sources.push("failed");
      }
    }
    const source: SearchProgress["source"] = sources.includes("failed")
      ? "failed"
      : sources.includes("api")
        ? "api"
        : sources.includes("message")
          ? "message"
          : "cache";
    if (source === "cache") monthsFromCache += 1;
    else if (source === "api") monthsFromApi += 1;
    deps.onProgress?.({ done: i + 1, total: monthList.length, month: formatMonth(month), source });
  }

  // 1) 설비용도구분
  let uncategorizedExcluded = 0;
  let filtered = all;
  if (category !== "전체") {
    filtered = all.filter((r) => {
      if (r.category === null) {
        uncategorizedExcluded += 1;
        return false;
      }
      return r.category.includes(category);
    });
  }

  // 1-2) 구 단위(포항시 남구·북구): 주소에 구 이름이 있는 기록만
  let districtExcluded = 0;
  if (region.district) {
    const d = region.district;
    filtered = filtered.filter((r) => {
      const ok = `${r.lotAddress ?? ""} ${r.roadAddress ?? ""}`.includes(d);
      if (!ok) districtExcluded += 1;
      return ok;
    });
  }

  // 2) 상호·주소 검색어 (낱말 모두 포함, 띄어쓰기·대소문자 무시)
  if (keyword) {
    const terms = keyword.split(/\s+/).map(compactLower).filter(Boolean);
    filtered = filtered.filter((r) => {
      const haystack = compactLower([r.businessName, r.lotAddress, r.roadAddress].filter(Boolean).join(" "));
      return terms.every((t) => haystack.includes(t));
    });
  }

  // 3) 검사일 최근 순
  const sorted = filtered
    .map((r, index) => ({ r, index }))
    .sort((a, b) => sortKey(b.r).localeCompare(sortKey(a.r)) || a.index - b.index)
    .map(({ r }) => r);

  // 4) 같은 상호·주소·호기번호는 최신 1건만 (식별 정보가 전혀 없는 기록은 묶지 않음)
  let deduped = sorted;
  if (latestOnly) {
    const seen = new Set<string>();
    deduped = sorted.filter((r, index) => {
      const hasIdentity = r.businessName || r.lotAddress || r.roadAddress;
      const id = hasIdentity
        ? [compactLower(r.businessName), compactLower(r.lotAddress), compactLower(r.roadAddress), r.unitNo ?? ""].join("|")
        : `#${index}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  const records = deduped.slice(0, limit);
  const period = { from: formatMonth(monthList[monthList.length - 1]), to: formatMonth(monthList[0]), months };

  const notes: string[] = [
    `출처: 한국전기안전공사 전기안전종합정보시스템 OpenAPI(검사점검이력정보), 조회기간 ${period.from}~${period.to}(${months}개월), 지역 ${region.name}(조회 코드 ${region.queries.map((q) => `${q.sido}-${q.gugun}`).join(", ")}).`,
    RECEIVING_UNIT_NOTE,
    `법적 근거: ${LEGAL_BASIS[0]} ${LEGAL_BASIS[1]}`,
    ...LIMITATIONS,
    `공식 확인처: 전기안전종합정보시스템 「검사·점검이력정보」 ${OFFICIAL_LOOKUP_URL}`,
  ];
  if (region.note) notes.push(`지역 유의사항: ${region.note}`);
  if (latestOnly) notes.push("같은 상호·주소·호기번호의 기록은 검사일이 가장 최근인 1건만 표시했습니다.");
  if (region.district) {
    notes.push(`시 전체 자료에서 주소에 '${region.district}'가 있는 기록만 남겼습니다(제외 ${districtExcluded}건, 주소가 비어 있는 기록 포함).`);
  }
  if (uncategorizedExcluded > 0) {
    notes.push(`설비용도구분 값이 없는 기록 ${uncategorizedExcluded}건은 '${category}' 조건에서 제외했습니다. '전체'로 조회하면 볼 수 있습니다.`);
  }
  if (failedMonths.length > 0) {
    notes.push(`⚠️ ${failedMonths.length}개월은 연결·응답 오류로 받지 못해 결과가 불완전합니다. 잠시 후 다시 조회하십시오.`);
  }
  if (UNVERIFIED_ITEMS.length > 0) notes.push(`확인 필요: ${UNVERIFIED_ITEMS.join(" / ")}`);

  return {
    region,
    service: SERVICE,
    period,
    query: { keyword, category, latestOnly, limit },
    counts: {
      fetchedRecords: all.length,
      uncategorizedExcluded,
      matchedRecords: sorted.length,
      distinctRecords: deduped.length,
      returnedRecords: records.length,
      truncated: deduped.length > records.length,
      monthsFromCache,
      monthsFromApi,
    },
    monthMessages,
    failedMonths,
    envelopePaths: [...envelopePaths],
    records,
    notes,
    generatedAt: now.toISOString(),
  };
}
