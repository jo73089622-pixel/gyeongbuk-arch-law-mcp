import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { formatSearchMarkdown } from "../elec/format.js";
import { KesApiError } from "../elec/kescoClient.js";
import { listSigungu, REGION_SOURCE, resolveSido, SIDO_LIST } from "../elec/regions.js";
import {
  CATEGORY_OPTIONS,
  defaultMonths,
  MAX_MONTHS,
  searchReceivingCapacity,
  SearchInputError,
} from "../elec/service.js";
import {
  DATA_SOURCE_LINES,
  LEGAL_BASIS,
  LIMITATIONS,
  OFFICIAL_LOOKUP_URL,
  OPENAPI_APPLY_URL,
  OPENAPI_INTRO_URL,
  UNVERIFIED_ITEMS,
} from "../elec/sources.js";
import { RECEIVING_UNIT_NOTE } from "../elec/types.js";

const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("출력 형식: 'markdown'(사람이 읽기 좋은 형식, 기본값) 또는 'json'(프로그램 처리용)");

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n⚠️ 응답이 너무 커서 일부만 표시했습니다 (전체 ${text.length}자 중 ${CHARACTER_LIMIT}자). 검색어를 넣거나 limit을 줄여 다시 조회하세요.`
  );
}

export function registerElecTools(server: McpServer): void {
  server.registerTool(
    "elec_list_regions",
    {
      title: "수전설비 조회 가능 지역(전국 시도·시군구) 목록",
      description: `elec_search_capacity에 넣을 수 있는 지역을 보여준다.

Args:
  - sido (string, 선택): 시도 이름(예: 경기, 경상북도) 또는 2자리 코드. 없으면 시도 목록을, 있으면 그 시도의 시군구와 5자리 코드를 보여준다.

출처: 국토교통부 법정동코드('존재' 코드). 시 아래 구(예: 수원시 장안구)는 시 전체를 조회한 뒤 주소로 거른다.`,
      inputSchema: z.object({ sido: z.string().max(20).optional().describe("시도 이름 또는 2자리 코드") }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sido }) => {
      if (!sido) {
        const text = ["# 시도 목록", "", ...SIDO_LIST.map((s) => `- ${s.name} (${s.code})`), "", `출처: ${REGION_SOURCE}`].join("\n");
        return { content: [{ type: "text", text }], structuredContent: { sidoList: [...SIDO_LIST] } };
      }
      const code = resolveSido(sido);
      if (!code) {
        return { isError: true, content: [{ type: "text", text: `시도를 찾지 못했습니다: '${sido}'. 시도 목록은 sido 없이 호출해 확인하십시오.` }] };
      }
      const rows = listSigungu(code);
      const text = [
        `# ${SIDO_LIST.find((s) => s.code === code)?.name} 시군구 (시군구코드)`,
        "",
        ...rows.map((s) => `- ${s.name}: ${s.code}${s.note ? ` — ${s.note}` : ""}`),
        "",
        `출처: ${REGION_SOURCE}`,
      ].join("\n");
      return { content: [{ type: "text", text }], structuredContent: { regions: rows } };
    }
  );

  server.registerTool(
    "elec_search_capacity",
    {
      title: "건축물 수전설비 용량 조회",
      description: `한국전기안전공사 전기안전정보공개 OpenAPI(검사점검이력정보)에서 시설의 수전전압(V)·수전용량(kW)과 검사 기록을 찾는다.

원문 명세상 이 API는 '조회연월 + 시군구' 단위로만 조회되므로, 지정한 시군구의 최근 N개월 자료를 한 달씩 받아 상호·주소 검색어로 걸러 낸다.
처음 조회하는 지역·기간은 한 달에 1회씩 API를 호출해 시간이 걸린다(기본 ${defaultMonths()}개월). 한 번 받은 달은 저장해 두고 다시 쓴다.

Args:
  - sigungu (string): 시도+시군구 이름(예: "경북 구미시", "경기 수원시 장안구") 또는 5자리 시군구코드(예: "47190"). 필수. "중구"처럼 여러 시도에 있는 이름은 시도를 붙인다.
  - keyword (string, 선택): 상호·주소 검색어. 공백으로 나눈 낱말을 모두 포함하는 기록만 찾는다. 번지가 응답에 없을 수 있으므로 상호명이나 동·도로명으로 찾는 것이 좋다.
  - months (number): 최근 몇 개월을 조회할지 (이번 달 포함, 1~${MAX_MONTHS}, 기본 ${defaultMonths()}). 정기검사는 대부분 2년 또는 3년마다(전후 2개월) 받는다(「전기안전관리법 시행규칙」 별표 4 제2호 나목).
  - category ('자가용'|'사업용'|'일반용'|'전체'): 검사점검설비용도구분 (기본 '자가용' — 수전설비 사용전검사·정기검사 대상).
  - latest_only (boolean): 같은 상호·주소·호기번호의 기록은 최신 1건만 (기본 true)
  - refresh (boolean): 저장본을 무시하고 다시 받기 (기본 false)
  - limit (number): 최대 표시 건수 (1~200, 기본 50)
  - response_format ('markdown'|'json')

Returns:
  지역·기간·건수 요약, 기록 목록(상호명, 지번·도로명주소, 수전전압, 수전용량, 발전전압·용량, 검사종류, 검사일, 결과, 안전등급), 유의사항(출처·단위 근거·법적 근거·확인 필요 사항).
  개인 성명(대표자·검사자·시공업체 대표자)은 포함하지 않는다. 결과가 없으면 '데이터 없음'으로 답하고 추정하지 않는다.

Error Handling:
  인증키 미설정·오류, 지역 인식 실패, 응답 형식 이상은 isError=true와 안내 문구로 돌려준다.`,
      inputSchema: z
        .object({
          sigungu: z.string().min(1).describe("시도+시군구 이름(예: 경북 구미시, 경기 수원시 장안구) 또는 5자리 시군구코드(예: 47190)"),
          keyword: z.string().max(100).optional().describe("상호·주소 검색어 (선택)"),
          months: z.number().int().min(1).max(MAX_MONTHS).default(defaultMonths()).describe("최근 몇 개월 (이번 달 포함)"),
          category: z.enum(CATEGORY_OPTIONS).default("자가용").describe("검사점검설비용도구분"),
          latest_only: z.boolean().default(true).describe("시설별 최신 1건만"),
          refresh: z.boolean().default(false).describe("저장본 무시하고 다시 받기"),
          limit: z.number().int().min(1).max(200).default(50).describe("최대 표시 건수"),
          response_format: responseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sigungu, keyword, months, category, latest_only, refresh, limit, response_format }, extra) => {
      const progressToken = extra._meta?.progressToken;
      try {
        const result = await searchReceivingCapacity(
          { sigungu, keyword, months, category, latestOnly: latest_only, refresh, limit },
          {
            signal: extra.signal,
            onProgress: (p) => {
              if (progressToken === undefined) return;
              void extra
                .sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: p.done,
                    total: p.total,
                    message: `${p.month} ${p.source === "cache" ? "저장본" : p.source === "api" ? "수신" : p.source === "failed" ? "실패" : "안내"}`,
                  },
                })
                .catch(() => undefined);
            },
          }
        );
        const text =
          response_format === "json" ? JSON.stringify(result, null, 2) : formatSearchMarkdown(result);
        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const message =
          err instanceof SearchInputError || err instanceof KesApiError
            ? err.message
            : `조회 중 오류가 발생했습니다: ${(err as Error).message}`;
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    }
  );

  server.registerTool(
    "elec_data_sources",
    {
      title: "수전설비 조회 자료의 출처·법적 근거·한계",
      description: `elec_search_capacity가 쓰는 자료의 출처, 법적 근거(조문), 단위 표기 근거, 자료의 한계, 아직 확인되지 않은 사항, 인증키 신청 방법을 안내한다.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const text = [
        "# 수전설비 용량 조회 — 출처와 근거",
        "",
        "## 자료 출처",
        ...DATA_SOURCE_LINES.map((l) => `- ${l}`),
        `- OpenAPI 명세 원문: ${OPENAPI_INTRO_URL}`,
        "",
        "## 법적 근거 (국가법령정보센터 현행 원문 대조)",
        ...LEGAL_BASIS.map((l) => `- ${l}`),
        "",
        "## 단위 표기 근거",
        `- ${RECEIVING_UNIT_NOTE}`,
        "",
        "## 자료의 한계",
        ...LIMITATIONS.map((l) => `- ${l}`),
        `- 공식 확인처: ${OFFICIAL_LOOKUP_URL}`,
        "",
        "## 확인 필요 사항 (인증키 발급 후 실제 응답으로 검증)",
        ...UNVERIFIED_ITEMS.map((l) => `- ${l}`),
        "",
        "## 인증키 신청",
        `- 전기안전종합정보시스템 > OpenAPI > OpenAPI신청 (${OPENAPI_APPLY_URL}) 에서 '검사점검이력정보'를 신청하면 관리자 승인 후 발급된다(활용기간 12개월).`,
        "- 발급받은 값을 .env 파일의 KESCO_API_KEY에 넣는다. 인증키는 요청 주소의 codeNo 변수로 전달된다.",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }
  );
}
