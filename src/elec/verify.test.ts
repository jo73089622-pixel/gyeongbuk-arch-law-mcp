import assert from "node:assert/strict";
import { test } from "node:test";
import { describeShape, hasBuildingNumber, hasLotNumber, shapeOf, summarizeRecords } from "./verify.js";

test("모양만 남기고 원문은 감춘다", () => {
  assert.equal(shapeOf("가나***"), "○○***");
  assert.equal(shapeOf("경북 구미시 공단동 123-4"), "○○ ○○○ ○○○ ###-#");
});

test("번지·건물번호 포함 여부를 판단한다", () => {
  assert.equal(hasLotNumber("전북 완주군 봉동읍 둔산리"), false);
  assert.equal(hasLotNumber("경북 구미시 공단동 123-4"), true);
  assert.equal(hasBuildingNumber("전북 완주군 봉동읍 완주산단6로"), false);
  assert.equal(hasBuildingNumber("경북 구미시 1공단로 12"), true);
  assert.equal(hasBuildingNumber("경북 구미시 산호대로 25-3"), true);
});

test("요약에는 원문 상호·주소·성명이 들어가지 않는다", () => {
  const s = summarizeRecords([
    { CMPNM: "가나병원", RPRSNTV: "홍**", LNM_ADRES: "경북 포항시 남구 대잠동 1", RN_ADRES: "경북 포항시 남구 희망대로 5", TRANSELE_CPCTY: "1,500", INSPCT_DIV: "자가용" },
    { cmpnm: "다라***", lnmAdres: "경북 포항시 북구 양덕동", TRANSELE_CPCTY: "" },
  ]);
  const json = JSON.stringify(s);
  for (const v of ["가나병원", "홍**", "대잠동", "희망대로", "다라"]) assert.equal(json.includes(v), false, v);
  assert.equal(s.records, 2);
  assert.equal(s.businessName.withAsterisk, 1);
  assert.equal(s.lotAddress.withNumber, 1);
  assert.equal(s.roadAddress.withBuildingNo, 1);
  assert.deepEqual([s.receivingCapacity.min, s.receivingCapacity.max], [1500, 1500]);
  assert.deepEqual(s.district, { 남구: 1, 북구: 1, 둘다아님: 0 });
  assert.ok(s.specFieldsMissing.includes("EQP_TY"));
});

test("응답 구조를 값 없이 나타낸다", () => {
  assert.deepEqual(describeShape({ result: [{ a: 1 }, { a: 2 }], total: 2 }), { result: "array(2)", total: "number" });
  assert.equal((describeShape({ result: "유효하지않은 코드입니다." }) as Record<string, unknown>).result, "string");
});
