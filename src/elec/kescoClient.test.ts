import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchKesMonth, KES_OPENAPI_URL, KesApiError, parseKesResponse } from "./kescoClient.js";

const rec = { CMPNM: "A", TRANSELE_CPCTY: "10" };

test("실측한 인증키 오류 응답은 auth 오류로 멈춘다", () => {
  assert.throws(
    () => parseKesResponse('{"result":"유효하지않은 코드입니다."}'),
    (err: unknown) => err instanceof KesApiError && err.kind === "auth"
  );
});

test("목록 위치를 찾아 envelopePath로 알려 준다 (정상 응답 구조는 미확인이라 여러 형태를 받는다)", () => {
  assert.deepEqual(parseKesResponse(JSON.stringify([rec])), { records: [rec], envelopePath: "$", message: null });
  assert.deepEqual(parseKesResponse(JSON.stringify({ result: [rec] })), { records: [rec], envelopePath: "result", message: null });
  assert.deepEqual(parseKesResponse(JSON.stringify({ response: { body: { items: { item: [rec, rec] } } } })), {
    records: [rec, rec],
    envelopePath: "response.body.items.item",
    message: null,
  });
  assert.deepEqual(parseKesResponse(JSON.stringify({ response: { body: { items: { item: rec } } } })), {
    records: [rec],
    envelopePath: "response.body.items.item",
    message: null,
  });
  assert.deepEqual(parseKesResponse("[]"), { records: [], envelopePath: "$", message: null });
});

test("목록 대신 문자열 안내가 오면 판단하지 않고 원문을 돌려준다 (시험용 가상 문구)", () => {
  assert.deepEqual(parseKesResponse('{"result":"시험용 안내 문구"}'), { records: [], envelopePath: null, message: "시험용 안내 문구" });
});

test("JSON이 아니거나 목록을 찾을 수 없으면 응답 앞부분을 보여 주는 형식 오류", () => {
  assert.throws(() => parseKesResponse("<html>점검 중</html>"), (e: unknown) => e instanceof KesApiError && e.kind === "format");
  assert.throws(() => parseKesResponse('{"a":1}'), (e: unknown) => e instanceof KesApiError && e.kind === "format");
});

test("원문 명세의 요청변수 이름(codeNo, service, searchYM, sido, gugun)으로 GET 호출한다", async () => {
  let calledUrl = "";
  let calledMethod = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    calledMethod = init?.method ?? "";
    return new Response(JSON.stringify({ result: [rec] }), { status: 200 });
  };
  const res = await fetchKesMonth(
    { apiKey: "KEY=", service: "inspctResultInfo", searchYM: "202510", sido: "47", gugun: "19" },
    { fetchImpl: fakeFetch }
  );
  const url = new URL(calledUrl);
  assert.equal(`${url.origin}${url.pathname}`, KES_OPENAPI_URL);
  assert.equal(calledMethod, "GET");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    codeNo: "KEY=",
    service: "inspctResultInfo",
    searchYM: "202510",
    sido: "47",
    gugun: "19",
  });
  assert.equal(res.records.length, 1);
});

test("HTTP 오류와 연결 오류를 구분한다", async () => {
  const q = { apiKey: "K", service: "inspctResultInfo" as const, searchYM: "202510", sido: "47", gugun: "19" };
  await assert.rejects(
    fetchKesMonth(q, { fetchImpl: async () => new Response("err", { status: 500 }) }),
    (e: unknown) => e instanceof KesApiError && e.kind === "http"
  );
  await assert.rejects(
    fetchKesMonth(q, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    (e: unknown) => e instanceof KesApiError && e.kind === "network"
  );
});
