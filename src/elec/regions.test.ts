import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_SIGUNGU, GYEONGBUK_SIGUNGU, KES_SIDO, lookupRegion, resolveSido, resolveSigungu, SIDO_LIST, toKesRegion } from "./regions.js";

test("명세 예시(sido=45, gugun=71)와 같은 규칙으로 시군구코드를 변환한다", () => {
  assert.deepEqual(toKesRegion("45710"), { sido: "45", gugun: "71" }); // 전북 완주군
  assert.deepEqual(toKesRegion("47190"), { sido: "47", gugun: "19" }); // 경북 구미시
});

test("현행 강원·전북 시도코드(51·52)는 전기안전종합정보시스템 코드(42·45)로 바꾼다", () => {
  assert.deepEqual(toKesRegion("52710"), { sido: "45", gugun: "71" });
  assert.deepEqual(toKesRegion("51110"), { sido: "42", gugun: "11" });
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
  const suwon = resolveSigungu("경기 수원시 장안구");
  assert.equal(suwon?.code, "41110");
  assert.equal(suwon?.district, "장안구");
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

test("공사 시스템 코드로 바꾼다: 강원 42·전북 45, 전남광주는 옛 29·46 코드", () => {
  assert.deepEqual(toKesRegion("51110"), { sido: "42", gugun: "11" }); // 춘천
  assert.deepEqual(toKesRegion("52110"), { sido: "45", gugun: "11" }); // 전주
  assert.deepEqual(toKesRegion("12210"), { sido: "29", gugun: "11" }); // 광주 동구 → 29110
  assert.deepEqual(toKesRegion("12740"), { sido: "46", gugun: "77" }); // 고흥군 → 46770
  assert.match(resolveSigungu("광주 동구")?.note ?? "", /옛 코드\(29110\)/);
});

test("시도 이름 해석", () => {
  assert.equal(resolveSido("경북"), "47");
  assert.equal(resolveSido("전라북도"), "52");
  assert.equal(resolveSido("광주"), "12");
  assert.equal(resolveSido("47"), "47");
  assert.equal(resolveSido("없는도"), undefined);
});
