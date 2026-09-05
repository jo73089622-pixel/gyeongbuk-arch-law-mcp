import "dotenv/config";

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
