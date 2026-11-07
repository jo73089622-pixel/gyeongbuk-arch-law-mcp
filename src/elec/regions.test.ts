import assert from "node:assert/strict";
import { test } from "node:test";
import { GYEONGBUK_SIGUNGU, KES_SIDO, resolveSigungu, toKesRegion } from "./regions.js";

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
  assert.equal(resolveSigungu("군위군"), undefined); // 2023. 7. 1. 대구광역시로 편입
  assert.equal(resolveSigungu("없는시"), undefined);
  assert.equal(resolveSigungu("99999"), undefined);
  assert.equal(resolveSigungu(""), undefined);
  assert.equal(resolveSigungu("북구"), undefined);
});

test("경상북도 밖의 5자리 코드는 목록 밖 지역으로 표시해 조회를 허용한다", () => {
  const r = resolveSigungu("27720"); // 대구광역시 군위군
  assert.ok(r);
  assert.equal(r.listed, false);
  assert.deepEqual({ sido: r.sido, gugun: r.gugun }, { sido: "27", gugun: "72" });
});
