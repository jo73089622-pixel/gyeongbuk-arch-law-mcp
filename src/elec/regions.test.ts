import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_SIGUNGU, GYEONGBUK_SIGUNGU, KES_SIDO, kesQueriesFor, lookupRegion, resolveSido, resolveSigungu, SIDO_LIST, toKesRegion } from "./regions.js";

test("명세 예시(sido=45, gugun=71)와 같은 규칙으로 시군구코드를 변환한다", () => {
  assert.deepEqual(toKesRegion("45710"), { sido: "45", gugun: "71" }); // 전북 완주군
  assert.deepEqual(toKesRegion("47190"), { sido: "47", gugun: "19" }); // 경북 구미시
});


test("시군구코드가 5자리 숫자가 아니면 오류", () => {
  assert.throws(() => toKesRegion("4719"));
  assert.throws(() => toKesRegion("abcde"));
});

test("경상북도 목록은 22개 시군이며 코드가 겹치지 않는다", () => {
  assert.equal(GYEONGBUK_SIGUNGU.length, 22);
  assert.equal(new Set(GYEONGBUK_SIGUNGU.map((s) => s.code)).size, 22);
  assert.ok(GYEONGBUK_SIGUNGU.every((s) => s.code.startsWith("47")));
  assert.ok(KES_SIDO.some((s) => s.code === "47" && s.name === "경상북도"));
});

test("시군 이름을 여러 형태로 입력해도 같은 지역으로 인식한다", () => {
  for (const input of ["구미시", "구미", "경북 구미시", "경상북도 구미시", " 47190 "]) {
    const r = resolveSigungu(input);
    assert.ok(r, input);
    assert.equal(r.code, "47190", input);
    assert.equal(r.name, "경상북도 구미시");
    assert.equal(r.listed, true);
  }
});

test("포항시 남구·북구는 포항시(47110)로 조회하고 구는 주소로 거른다 (실측 반영)", () => {
  const cases: Array<[string, string | undefined]> = [["포항시 남구", "남구"], ["포항시북구", "북구"], ["47111", "남구"], ["47113", "북구"], ["포항", undefined], ["47110", undefined]];
  for (const [input, district] of cases) {
    const r = resolveSigungu(input);
    assert.ok(r, input);
    assert.equal(r.code, "47110", input);
    assert.equal(r.gugun, "11");
    assert.equal(r.district, district, input);
  }
  assert.equal(resolveSigungu("47111")?.name, "경상북도 포항시 남구");
});

test("찾을 수 없는 지역은 추측하지 않고 undefined", () => {
  assert.equal(resolveSigungu("없는시"), undefined);
  assert.equal(resolveSigungu("99999"), undefined);
  assert.equal(resolveSigungu(""), undefined);
  assert.equal(resolveSigungu("북구"), undefined);
});

test("전국 목록: 시도 16, 시군구 269 (국토교통부 법정동코드 2026-09-29)", () => {
  assert.equal(SIDO_LIST.length, 16);
  assert.equal(ALL_SIGUNGU.length, 269);
  assert.equal(new Set(ALL_SIGUNGU.map((s) => s.code)).size, 269);
});

test("다른 시도의 이름과 코드도 찾는다", () => {
  assert.equal(resolveSigungu("대구 군위군")?.code, "27720");
  assert.equal(resolveSigungu("군위군")?.code, "27720");
  assert.equal(resolveSigungu("27720")?.name, "대구광역시 군위군");
  assert.equal(resolveSigungu("수원장안구")?.sigunguCode, "41111");
  assert.equal(resolveSigungu("세종")?.code, "36110");
});

test("여러 시도에 있는 이름은 후보를 돌려주고 추측하지 않는다", () => {
  const r = lookupRegion("중구");
  assert.ok("candidates" in r && r.candidates.includes("서울특별시 중구"));
  assert.equal(resolveSigungu("서울 중구")?.code, "11140");
  const g = lookupRegion("고성군");
  assert.ok("candidates" in g && g.candidates.length === 2);
});

test("실측에 따른 조회 코드: 강원 51, 전북 52+45, 전남광주 새+옛 코드, 인천 신설 구는 옛 구 코드도", () => {
  assert.deepEqual(kesQueriesFor("51110"), [{ sido: "51", gugun: "11" }]);
  assert.deepEqual(kesQueriesFor("52110"), [{ sido: "52", gugun: "11" }, { sido: "45", gugun: "11" }]);
  assert.deepEqual(kesQueriesFor("12210"), [{ sido: "12", gugun: "21" }, { sido: "29", gugun: "11" }]);
  assert.deepEqual(kesQueriesFor("12740"), [{ sido: "12", gugun: "74" }, { sido: "46", gugun: "77" }]);
  assert.deepEqual(kesQueriesFor("28125"), [{ sido: "28", gugun: "12" }, { sido: "28", gugun: "11" }, { sido: "28", gugun: "14" }]);
  assert.deepEqual(kesQueriesFor("11215"), [{ sido: "11", gugun: "21" }]);
});

test("주소에 구 이름이 없는 시(수원 등)는 구를 골라도 시 전체를 조회한다", () => {
  const r = resolveSigungu("경기 수원시 장안구");
  assert.equal(r?.code, "41110");
  assert.equal(r?.district, undefined);
  assert.match(r?.name ?? "", /수원시 전체/);
  assert.equal(resolveSigungu("포항시 남구")?.district, "남구");
});

test("시도 이름 해석", () => {
  assert.equal(resolveSido("경북"), "47");
  assert.equal(resolveSido("전라북도"), "52");
  assert.equal(resolveSido("광주"), "12");
  assert.equal(resolveSido("47"), "47");
  assert.equal(resolveSido("없는도"), undefined);
});
