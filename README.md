# gyeongbuk-arch-law-mcp

경상북도 건축 관련 법령 데이터를 국가법령정보센터 오픈API에서 가져와 저장하고,
MCP(Model Context Protocol) 서버로 조회할 수 있게 하는 프로젝트.

## ⚠️ 스키마 검증 상태

`src/lawApiTypes.ts` / `src/parseLawApi.ts` / `src/lawApiClient.ts`는 국가법령정보센터
오픈API 응답 구조에 대해 일반적으로 알려진 형태를 "가정"해 작성한 초안입니다.
이 개발 환경은 `law.go.kr` 도메인 접속이 네트워크 프록시에서 차단되어 있어 실제
응답으로 검증하지 못했습니다. 처음 실제 데이터를 받아올 때는 `fetchLaw.js` 실행 로그의
경고 메시지를 꼭 확인하고, 필요하면 `src/lawApiTypes.ts`를 실제 응답에 맞게 수정하세요.

## 설치

```bash
npm install
cp .env.example .env   # LAW_GO_KR_OC, REB_API_KEY 등 발급받은 값 채우기
npm run build
```

## 법령 데이터 받아오기

```bash
# 국가법령정보센터 오픈API를 호출해 원본 JSON을 data/raw/ 에, 파싱 결과를 data/laws/ 에 저장
npm run fetch:law -- --mst <MST번호>
npm run fetch:law -- --id <법령ID> --jo "제1조"

# 이미 갖고 있는 원본 API 응답 JSON 파일을 파싱만 하고 싶을 때
npm run parse:law -- <원본 JSON 파일 경로>
```

## MCP 서버 실행

```bash
npm run build
npm start
```

Claude Desktop 등 MCP 클라이언트 설정(`claude_desktop_config.json`)에 추가하는 예:

```json
{
  "mcpServers": {
    "gyeongbuk-arch-law": {
      "command": "node",
      "args": ["/absolute/path/to/gyeongbuk-arch-law-mcp/dist/index.js"]
    }
  }
}
```

### 제공 도구

- `law_list_laws` — `data/laws/`에 저장된 법령 목록 조회
- `law_get_law` — lawId로 법령 기본 정보 + 전체 조문 조회
- `law_get_article` — lawId + 조문 번호로 특정 조문 조회
- `law_search_articles` — 저장된 법령들의 조문 텍스트에서 키워드 검색 (페이지네이션 지원)

모든 도구는 `response_format`(`markdown` | `json`)을 지원하며, 아직 데이터를 받아오지
않았다면 `law_list_laws`가 안내 메시지와 함께 빈 목록을 반환합니다.
