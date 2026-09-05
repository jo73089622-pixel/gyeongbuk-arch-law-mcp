/**
 * 사용법:
 *   node dist/scripts/fetchLaw.js --mst <MST번호>
 *   node dist/scripts/fetchLaw.js --id <법령ID> [--jo "제1조"]
 *
 * 실행 전: .env 파일에 LAW_GO_KR_OC=<발급받은 OC 아이디> 설정 필요 (.env.example 참고)
 *
 * ⚠️ 이 개발 환경은 law.go.kr 접속이 네트워크 프록시에서 차단되어 있어
 * 이 스크립트를 이 환경에서 실행하면 실패합니다. 네트워크가 열린 곳에서
 * 실행해 원본 JSON을 받고, 그 결과로 src/lawApiTypes.ts / parseLawApi.ts의
 * 스키마 가정이 맞는지 검증하세요.
 */

import { fetchLawText } from "../lawApiClient.js";
import { parseLawApiResponse } from "../parseLawApi.js";
import { writeJSON } from "../storage.js";

interface Args {
  mst?: string;
  id?: string;
  jo?: string;
}

function parseArgs(argv: string[]): Args {
  const result: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mst") result.mst = argv[++i];
    else if (argv[i] === "--id") result.id = argv[++i];
    else if (argv[i] === "--jo") result.jo = argv[++i];
  }
  return result;
}

async function main(): Promise<void> {
  const { mst, id, jo } = parseArgs(process.argv.slice(2));
  if (!mst && !id) {
    console.error("사용법: node dist/scripts/fetchLaw.js --mst <MST> | --id <법령ID> [--jo <조문>]");
    process.exitCode = 1;
    return;
  }

  const raw = await fetchLawText({ mst, id, jo });

  const rawFileName = `raw/${mst ?? id}.json`;
  await writeJSON(rawFileName, raw);
  console.log(`원본 응답 저장: data/${rawFileName}`);
  console.log("이 파일을 열어 실제 키 구조가 src/lawApiTypes.ts 가정과 맞는지 꼭 확인하세요.");

  const parsed = parseLawApiResponse(raw);
  if (!parsed.lawId || !parsed.lawName || parsed.articles.length === 0) {
    console.warn(
      "⚠️ 파싱 결과가 비어 있습니다. lawApiTypes.ts / parseLawApi.ts의 필드명이 " +
        "실제 응답과 다를 가능성이 높으니 원본 파일과 대조해 수정하세요."
    );
    return;
  }

  const parsedFileName = `laws/${parsed.lawId}.json`;
  await writeJSON(parsedFileName, parsed);
  console.log(`파싱 결과 저장: data/${parsedFileName} (조문 ${parsed.articles.length}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
