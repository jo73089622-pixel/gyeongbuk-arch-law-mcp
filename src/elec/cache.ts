/**
 * 월별 조회 결과 파일 저장소.
 *
 * 위치: data/kesco/cache/<서비스>/<sido><gugun>/<YYYYMM>.json  (data/ 는 저장소에 올리지 않음)
 * 유효기간:
 *  - 지난달보다 이전 달: 다시 받지 않음 (화면의 '새로 받기'로 갱신 가능)
 *  - 이번 달·지난달: 받은 지 12시간이 지나면 다시 받음 (검사 결과 입력이 늦을 수 있어서)
 * 인증키 오류·연결 오류·안내 문구 응답은 저장하지 않는다.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import type { KesRawRecord, KesService } from "./types.js";

export const DEFAULT_CACHE_DIR = path.join(DATA_DIR, "kesco", "cache");
const RECENT_TTL_MS = 12 * 60 * 60 * 1000;

export interface CacheEntry {
  fetchedAt: string;
  envelopePath: string | null;
  records: KesRawRecord[];
}

export interface CacheKey {
  service: KesService;
  sido: string;
  gugun: string;
  month: string;
}

function cacheFile(dir: string, key: CacheKey): string {
  if (!/^\d{6}$/.test(key.month) || !/^\d{2}$/.test(key.sido) || !/^\d{2}$/.test(key.gugun)) {
    throw new Error("잘못된 저장소 키입니다.");
  }
  return path.join(dir, key.service, `${key.sido}${key.gugun}`, `${key.month}.json`);
}

export async function readCache(dir: string, key: CacheKey): Promise<CacheEntry | null> {
  try {
    const raw = await fs.readFile(cacheFile(dir, key), "utf-8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(parsed.records) || typeof parsed.fetchedAt !== "string") return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (err instanceof SyntaxError) return null; // 깨진 파일은 없는 것으로 보고 다시 받는다
    throw err;
  }
}

export async function writeCache(dir: string, key: CacheKey, entry: CacheEntry): Promise<void> {
  const file = cacheFile(dir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entry), "utf-8");
  await fs.rename(tmp, file);
}

/**
 * 저장된 자료를 그대로 써도 되는지 판단한다.
 * @param month 조회연월 YYYYMM
 * @param previousMonth 기준 시점의 지난달 YYYYMM (한국 시간 기준)
 */
export function isCacheFresh(entry: CacheEntry, month: string, previousMonth: string, now: Date): boolean {
  if (month < previousMonth) return true;
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedAt)) return false;
  return now.getTime() - fetchedAt < RECENT_TTL_MS;
}
