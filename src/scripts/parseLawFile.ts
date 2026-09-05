/**
 * 사용법:
 *   node dist/scripts/parseLawFile.js <국가법령정보센터 오픈API 원본 JSON 파일 경로>
 *
 * 국가법령정보센터 오픈API(lawService.do 등)를 호출해 받은 원본 JSON 응답
 * 파일을 읽어 parseLawApiResponse로 정리한 뒤 data/laws/{법령ID}.json 으로 저장한다.
 *
 * ⚠️ parseLawApi.ts / lawApiTypes.ts는 미검증 스키마 기반 초안이므로,
 * 실제 원본 JSON으로 처음 실행할 때는 아래 경고 로그를 반드시 확인할 것.
 */

import fs from "node:fs/promises";
import { parseLawApiResponse } from "../parseLawApi.js";
import type { RawLawResponse } from "../lawApiTypes.js";
import { writeJSON } from "../storage.js";

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("사용법: node dist/scripts/parseLawFile.js <원본 API 응답 JSON 파일 경로>");
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(await fs.readFile(inputPath, "utf-8")) as RawLawResponse;
  const parsed = parseLawApiResponse(raw);

  if (!parsed.lawId || !parsed.lawName || parsed.articles.length === 0) {
    console.warn(
      "⚠️ 경고: lawId/lawName/조문 중 일부를 찾지 못했습니다. " +
        "lawApiTypes.ts의 필드명이 실제 응답 구조와 다를 가능성이 높습니다. " +
        "원본 JSON의 실제 키 이름을 확인해 lawApiTypes.ts / parseLawApi.ts를 수정하세요."
    );
  }

  const fileName = `laws/${parsed.lawId ?? "unknown"}.json`;
  await writeJSON(fileName, parsed);
  console.log(`저장 완료: data/${fileName} (조문 ${parsed.articles.length}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
