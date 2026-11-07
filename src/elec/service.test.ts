import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PROJECT_ROOT } from "../config.js";
import { formatSearchMarkdown } from "./format.js";
import { KesApiError, type KesMonthQuery, type KesMonthResponse } from "./kescoClient.js";
import { recentMonthsKst, searchReceivingCapacity, SearchInputError } from "./service.js";
import type { KesRawRecord } from "./types.js";

// 명세 예시값(실제 응답 아님)을 바탕으로 시험 기록을 만든다.
const sample = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "fixtures", "kesco-spec-sample-record.json"), "utf-8"))
  .record as KesRawRecord;
const rec = (overrides: KesRawRecord): KesRawRecord => ({ ...sample, ...overrides });

const NOW = new Date("2026-11-05T03:00:00Z"); // 한국 시간 2026-11-05 12:00

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kesco-cache-"));
}

function fakeFetch(byMonth: Record<string, KesRawRecord[]>, calls: KesMonthQuery[] = []) {
  return async (q: KesMonthQuery): Promise<KesMonthResponse> => {
    calls.push(q);
    return { records: byMonth[q.searchYM] ?? [], envelopePath: "result", message: null };
  };
}

test("한국 시간 기준으로 이번 달부터 거꾸로 N개월을 만든다", () => {
  assert.deepEqual(recentMonthsKst(new Date("2026-11-04T16:00:00Z"), 3), ["202611", "202610", "202609"]);
  assert.deepEqual(recentMonthsKst(new Date("2026-10-31T15:30:00Z"), 1), ["202611"]); // KST 11월 1일 00:30
  assert.deepEqual(recentMonthsKst(new Date("2026-01-15T00:00:00Z"), 3), ["202601", "202512", "202511"]);
  assert.equal(recentMonthsKst(NOW, 38).length, 38);
  assert.equal(recentMonthsKst(NOW, 38).at(-1), "202310");
});

test("시군·기간에 맞춰 한 달씩 원문 명세 변수로 호출한다", async () => {
  const calls: KesMonthQuery[] = [];
  const result = await searchReceivingCapacity(
    { sigungu: "구미시", months: 3 },
    { apiKey: "K", cacheDir: tmpDir(), now: NOW, delayMs: 0, fetchMonth: fakeFetch({}, calls) }
  );
  assert.deepEqual(
    calls.map((c) => [c.searchYM, c.sido, c.gugun, c.service, c.apiKey]),
    [
      ["202611", "47", "19", "inspctResultInfo", "K"],
      ["202610", "47", "19", "inspctResultInfo", "K"],
      ["202609", "47", "19", "inspctResultInfo", "K"],
    ]
  );
  assert.deepEqual(result.period, { from: "2026-09", to: "2026-11", months: 3 });
  assert.equal(result.records.length, 0);
  assert.match(formatSearchMarkdown(result), /데이터 없음/);
});

test("구분(기본 자가용)·검색어(낱말 모두 포함)로 거른다", async () => {
  const deps = {
    apiKey: "K",
    cacheDir: tmpDir(),
    now: NOW,
    delayMs: 0,
    fetchMonth: fakeFetch({
      "202611": [rec({ CMPNM: "가나병원" }), rec({ CMPNM: "다라주택", INSPCT_DIV: "일반용" })],
    }),
  };
  const r1 = await searchReceivingCapacity({ sigungu: "47190", months: 1 }, deps);
  assert.deepEqual(r1.records.map((r) => r.businessName), ["가나병원"]);

  const r2 = await searchReceivingCapacity({ sigungu: "47190", months: 1, category: "전체" }, deps);
  assert.equal(r2.records.length, 2);

  const r3 = await searchReceivingCapacity({ sigungu: "47190", months: 1, keyword: "가나 완주산단6로" }, deps);
  assert.deepEqual(r3.records.map((r) => r.businessName), ["가나병원"]);

  const r4 = await searchReceivingCapacity({ sigungu: "47190", months: 1, keyword: "가나 없는길" }, deps);
  assert.equal(r4.records.length, 0);
});

test("같은 상호·주소·호기번호는 검사일이 최근인 1건만 남긴다 (끄면 모두)", async () => {
  const deps = {
    apiKey: "K",
    cacheDir: tmpDir(),
    now: NOW,
    delayMs: 0,
    fetchMonth: fakeFetch({
      "202611": [rec({ INSPCT_ENDDE: "2026-11-02", TRANSELE_CPCTY: "1500" })],
      "202510": [rec({ INSPCT_ENDDE: "2025-10-20", TRANSELE_CPCTY: "1000" })],
    }),
  };
  const latest = await searchReceivingCapacity({ sigungu: "구미시", months: 14 }, deps);
  assert.equal(latest.records.length, 1);
  assert.equal(latest.records[0].receivingCapacityKw, 1500);
  assert.equal(latest.counts.matchedRecords, 2);
  assert.equal(latest.counts.distinctRecords, 1);

  const all = await searchReceivingCapacity({ sigungu: "구미시", months: 14, latestOnly: false }, deps);
  assert.deepEqual(all.records.map((r) => r.receivingCapacityKw), [1500, 1000]);
});

test("받은 달은 저장해 다시 쓰고, 이번 달·지난달은 12시간이 지나면 다시 받는다", async () => {
  const cacheDir = tmpDir();
  const first: KesMonthQuery[] = [];
  await searchReceivingCapacity(
    { sigungu: "구미시", months: 3 },
    { apiKey: "K", cacheDir, now: NOW, delayMs: 0, fetchMonth: fakeFetch({ "202609": [rec({})] }, first) }
  );
  assert.equal(first.length, 3);

  const second: KesMonthQuery[] = [];
  const r = await searchReceivingCapacity(
    { sigungu: "구미시", months: 3 },
    { apiKey: "K", cacheDir, now: new Date(NOW.getTime() + 60 * 60 * 1000), delayMs: 0, fetchMonth: fakeFetch({}, second) }
  );
  assert.equal(second.length, 0);
  assert.equal(r.counts.monthsFromCache, 3);
  assert.equal(r.counts.fetchedRecords, 1);

  const third: KesMonthQuery[] = [];
  await searchReceivingCapacity(
    { sigungu: "구미시", months: 3 },
    { apiKey: "K", cacheDir, now: new Date(NOW.getTime() + 13 * 60 * 60 * 1000), delayMs: 0, fetchMonth: fakeFetch({}, third) }
  );
  assert.deepEqual(third.map((c) => c.searchYM), ["202611", "202610"]);

  const refreshed: KesMonthQuery[] = [];
  await searchReceivingCapacity(
    { sigungu: "구미시", months: 3, refresh: true },
    { apiKey: "K", cacheDir, now: NOW, delayMs: 0, fetchMonth: fakeFetch({}, refreshed) }
  );
  assert.equal(refreshed.length, 3);
});

test("일부 달의 연결 오류는 건너뛰고 결과가 불완전하다고 알린다", async () => {
  const result = await searchReceivingCapacity(
    { sigungu: "구미시", months: 2 },
    {
      apiKey: "K",
      cacheDir: tmpDir(),
      now: NOW,
      delayMs: 0,
      fetchMonth: async (q) => {
        if (q.searchYM === "202610") throw new KesApiError("network", "연결 실패(시험)");
        return { records: [rec({})], envelopePath: "result", message: null };
      },
    }
  );
  assert.deepEqual(result.failedMonths.map((f) => f.month), ["2026-10"]);
  assert.equal(result.records.length, 1);
  assert.ok(result.notes.some((n) => n.includes("결과가 불완전")));
});

test("안내 문구가 온 달은 저장하지 않고 원문을 그대로 알린다", async () => {
  const cacheDir = tmpDir();
  const deps = {
    apiKey: "K",
    cacheDir,
    now: NOW,
    delayMs: 0,
    fetchMonth: async (): Promise<KesMonthResponse> => ({ records: [], envelopePath: null, message: "시험용 안내 문구" }),
  };
  const r = await searchReceivingCapacity({ sigungu: "구미시", months: 1 }, deps);
  assert.deepEqual(r.monthMessages, [{ month: "2026-11", message: "시험용 안내 문구" }]);
  assert.equal(fs.readdirSync(cacheDir).length, 0);
});

test("인증키 오류·미설정, 알 수 없는 지역은 즉시 멈춘다", async () => {
  await assert.rejects(
    searchReceivingCapacity(
      { sigungu: "구미시", months: 3 },
      {
        apiKey: "BAD",
        cacheDir: tmpDir(),
        now: NOW,
        delayMs: 0,
        fetchMonth: async () => {
          throw new KesApiError("auth", "인증키 오류: 유효하지않은 코드입니다.");
        },
      }
    ),
    (e: unknown) => e instanceof KesApiError && e.kind === "auth"
  );
  await assert.rejects(
    searchReceivingCapacity({ sigungu: "구미시", months: 1 }, { apiKey: "", cacheDir: tmpDir(), now: NOW, delayMs: 0 }),
    /KESCO_API_KEY/
  );
  await assert.rejects(searchReceivingCapacity({ sigungu: "없는시" }, { apiKey: "K", cacheDir: tmpDir(), now: NOW }), SearchInputError);
});

test("결과에는 개인 성명이 들어가지 않는다", async () => {
  const r = await searchReceivingCapacity(
    { sigungu: "구미시", months: 1 },
    { apiKey: "K", cacheDir: tmpDir(), now: NOW, delayMs: 0, fetchMonth: fakeFetch({ "202611": [rec({})] }) }
  );
  const text = JSON.stringify(r) + formatSearchMarkdown(r);
  for (const value of ["대**", "박**", "시공업체대표자명"]) assert.equal(text.includes(value), false, value);
  assert.match(formatSearchMarkdown(r), /수전용량\(kW\)/);
});

test("포항시 남구로 조회하면 포항시 전체 자료에서 주소에 '남구'가 있는 기록만 남긴다", async () => {
  const r = await searchReceivingCapacity(
    { sigungu: "포항시 남구", months: 1 },
    {
      apiKey: "K",
      cacheDir: tmpDir(),
      now: NOW,
      delayMs: 0,
      fetchMonth: fakeFetch({
        "202611": [
          rec({ CMPNM: "갑", LNM_ADRES: "경상북도 포항시 남구 대잠동 1", RN_ADRES: null }),
          rec({ CMPNM: "을", LNM_ADRES: "경상북도 포항시 북구 양덕동 2", RN_ADRES: null }),
        ],
      }),
    }
  );
  assert.deepEqual(r.records.map((x) => x.businessName), ["갑"]);
  assert.ok(r.notes.some((n) => n.includes("제외 1건")));
});

test("수전용량 0은 원문 값임을 표시한다", async () => {
  const r = await searchReceivingCapacity(
    { sigungu: "구미시", months: 1 },
    { apiKey: "K", cacheDir: tmpDir(), now: NOW, delayMs: 0, fetchMonth: fakeFetch({ "202611": [rec({ TRANSELE_CPCTY: "0" })] }) }
  );
  assert.equal(r.records[0].receivingCapacityKw, 0);
  assert.match(formatSearchMarkdown(r), /0\(원문 값\)/);
});

test("행정구역 개편 지역은 새·옛 코드를 모두 조회해 같은 기록은 한 번만 합친다", async () => {
  const calls: KesMonthQuery[] = [];
  const same = rec({ CMPNM: "공통" });
  const r = await searchReceivingCapacity(
    { sigungu: "광주 동구", months: 1, category: "전체", latestOnly: false },
    {
      apiKey: "K",
      cacheDir: tmpDir(),
      now: NOW,
      delayMs: 0,
      fetchMonth: async (q) => {
        calls.push(q);
        const records = q.sido === "12" ? [same, rec({ CMPNM: "새코드" })] : [same, rec({ CMPNM: "옛코드" })];
        return { records, envelopePath: "result", message: null };
      },
    }
  );
  assert.deepEqual(calls.map((c) => `${c.sido}-${c.gugun}`), ["12-21", "29-11"]);
  assert.deepEqual(r.records.map((x) => x.businessName).sort(), ["공통", "새코드", "옛코드"]);
});
