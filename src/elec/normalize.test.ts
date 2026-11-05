import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PROJECT_ROOT } from "../config.js";
import { normalizeRecord, parseNumber, toSpecKey } from "./normalize.js";

// 명세 예시값(실제 응답 아님) — fixtures/kesco-spec-sample-record.json 설명 참고
const sample = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "fixtures", "kesco-spec-sample-record.json"), "utf-8"))
  .record as Record<string, unknown>;

test("명세 예시값을 화면용 기록으로 옮긴다 (값을 바꾸지 않음)", () => {
  const r = normalizeRecord(sample, "202110");
  assert.equal(r.category, "자가용");
  assert.equal(r.inspectionType, "사용전검사");
  assert.equal(r.equipmentType, "수변전설비");
  assert.equal(r.businessName, "상호명");
  assert.equal(r.lotAddress, "전북 완주군 봉동읍 둔산리");
  assert.equal(r.roadAddress, "전북 완주군 봉동읍 완주산단6로");
  assert.equal(r.receivingVoltageV, 10);
  assert.equal(r.receivingCapacityKw, 10);
  assert.equal(r.generationVoltageV, 22900);
  assert.equal(r.generationCapacityKw, 22900);
  assert.equal(r.voltageV, 220);
  assert.equal(r.capacityKw, 3);
  assert.equal(r.raw.receivingCapacity, "10");
  assert.equal(r.inspectionEnd, "2021-10-10");
  assert.equal(r.result, "정상");
  assert.equal(r.safetyGrade, "A");
  assert.equal(r.sourceMonth, "202110");
});

test("개인 성명과 시공업체명은 결과에 남기지 않는다", () => {
  const json = JSON.stringify(normalizeRecord(sample, "202110"));
  for (const value of ["대**", "박**", "시공업체대표자명", "시공업체"]) {
    assert.equal(json.includes(value), false, value);
  }
});

test("camelCase·소문자 키도 같은 항목으로 읽는다", () => {
  assert.equal(toSpecKey("transeleCpcty"), "TRANSELE_CPCTY");
  assert.equal(toSpecKey("transele_cpcty"), "TRANSELE_CPCTY");
  assert.equal(toSpecKey("TRANSELE_CPCTY"), "TRANSELE_CPCTY");
  const r = normalizeRecord({ transeleCpcty: "1,000", cmpnm: "가나다", lnmAdres: "경북 구미시" }, "202501");
  assert.equal(r.receivingCapacityKw, 1000);
  assert.equal(r.businessName, "가나다");
  assert.equal(r.lotAddress, "경북 구미시");
});

test("숫자로 읽을 수 없는 값은 null로 두고 원문은 보존한다", () => {
  assert.equal(parseNumber("1,000"), 1000);
  assert.equal(parseNumber(" 22900 "), 22900);
  assert.equal(parseNumber("12.5"), 12.5);
  assert.equal(parseNumber(12.5), 12.5);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(null), null);
  const r = normalizeRecord({ TRANSELE_CPCTY: "약 300" }, "202501");
  assert.equal(r.receivingCapacityKw, null);
  assert.equal(r.raw.receivingCapacity, "약 300");
});
