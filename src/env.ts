import path from "node:path";
import dotenv from "dotenv";
import { PROJECT_ROOT } from "./config.js";

// 실행 위치(cwd)와 관계없이 저장소 최상위의 .env 를 읽는다.
// 이미 설정된 환경변수(예: Claude Desktop 설정의 env)는 덮어쓰지 않는다.
dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });

export function requireLawGoKrOc(): string {
  const oc = process.env.LAW_GO_KR_OC;
  if (!oc) {
    throw new Error(
      "LAW_GO_KR_OC 환경변수가 설정되어 있지 않습니다. " +
        ".env 파일을 만들고 LAW_GO_KR_OC=<발급받은 OC 아이디>를 추가하세요 (.env.example 참고)."
    );
  }
  return oc;
}

export function requireRebApiKey(): string {
  const key = process.env.REB_API_KEY;
  if (!key) {
    throw new Error(
      "REB_API_KEY 환경변수가 설정되어 있지 않습니다. " +
        ".env 파일을 만들고 REB_API_KEY=<발급받은 R-ONE 인증키>를 추가하세요 (.env.example 참고)."
    );
  }
  return key;
}

/** 값 자체는 내보내지 않고 설정 여부만 알려 준다. */
export function hasKescoApiKey(): boolean {
  return Boolean(process.env.KESCO_API_KEY?.trim());
}

export function hasAnthropicApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
