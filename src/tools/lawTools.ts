import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { LawArticle } from "../parseLawApi.js";
import { getArticle, getLaw, listLaws, searchArticles, type LawSummary } from "../services/lawRepository.js";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const responseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("출력 형식: 'markdown'(사람이 읽기 좋은 형식, 기본값) 또는 'json'(프로그램 처리용)");

function normalizeArticleNumber(input: string): string {
  return input.replace(/^제/, "").replace(/조$/, "").trim();
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  const cut = text.slice(0, CHARACTER_LIMIT);
  return {
    text:
      cut +
      `\n\n⚠️ 응답이 너무 커서 일부만 표시했습니다 (전체 ${text.length}자 중 ${CHARACTER_LIMIT}자). ` +
      "lawId나 검색어 범위를 좁혀서 다시 조회하세요.",
    truncated: true,
  };
}

function formatArticleMarkdown(article: LawArticle): string {
  const heading = `### 제${article.number ?? "?"}조${article.branchNumber ? `의${article.branchNumber}` : ""}${
    article.title ? `(${article.title})` : ""
  }`;
  const lines = [heading];
  if (article.content) lines.push(article.content);
  for (const paragraph of article.paragraphs) {
    if (paragraph.content) lines.push(paragraph.content);
    for (const subItem of paragraph.subItems) {
      if (subItem.content) lines.push(subItem.content);
      for (const item of subItem.items) {
        if (item.content) lines.push(`  ${item.content}`);
      }
    }
  }
  return lines.join("\n");
}

function formatLawSummaryMarkdown(law: LawSummary): string {
  return `- **${law.lawName ?? "(이름 없음)"}** (lawId: ${law.lawId}) — ${law.lawType ?? "구분 미상"} · ${
    law.ministry ?? "소관부처 미상"
  } · 시행일 ${law.effectiveDate ?? "미상"} · 조문 ${law.articleCount}개`;
}

const NO_DATA_HINT =
  "저장된 법령 데이터가 없습니다. `node dist/scripts/fetchLaw.js --mst <MST>` 또는 " +
  "`--id <법령ID>` 로 국가법령정보센터 오픈API를 호출해 데이터를 먼저 받아오세요.";

export function registerLawTools(server: McpServer): void {
  server.registerTool(
    "law_list_laws",
    {
      title: "저장된 법령 목록 조회",
      description: `data/laws/ 에 파싱되어 저장된 법령 목록을 조회한다.

이 도구는 국가법령정보센터 오픈API에서 미리 가져와 파싱해둔 법령만 보여준다. 실시간으로 API를 호출하지 않는다. 아직 아무 법령도 받아오지 않았다면 빈 목록을 반환하며, 이 경우 CLI(node dist/scripts/fetchLaw.js)로 먼저 데이터를 채워야 한다.

Args:
  - response_format ('markdown' | 'json'): 출력 형식 (기본값: markdown)

Returns:
  각 법령의 lawId, lawName, lawType(법률/대통령령 등), ministry(소관부처), effectiveDate(시행일), articleCount(조문 수)`,
      inputSchema: z.object({ response_format: responseFormatSchema }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ response_format }) => {
      const laws = await listLaws();
      if (laws.length === 0) {
        return { content: [{ type: "text", text: NO_DATA_HINT }], structuredContent: { total: 0, laws: [] } };
      }

      const output = { total: laws.length, laws };
      const text =
        response_format === ResponseFormat.JSON
          ? JSON.stringify(output, null, 2)
          : [`# 저장된 법령 (${laws.length}건)`, "", ...laws.map(formatLawSummaryMarkdown)].join("\n");

      return { content: [{ type: "text", text }], structuredContent: output };
    }
  );

  server.registerTool(
    "law_get_law",
    {
      title: "법령 상세(전체 조문) 조회",
      description: `lawId로 저장된 법령 한 건의 기본 정보와 전체 조문을 조회한다.

Args:
  - lawId (string): 법령ID (law_list_laws 결과의 lawId, 예: "001823")
  - response_format ('markdown' | 'json'): 출력 형식 (기본값: markdown)

Returns:
  법령명, 공포/시행일, 소관부처, 전체 조문(조/항/호/목) 목록.

Error Handling:
  해당 lawId가 저장되어 있지 않으면 isError=true와 함께 안내 메시지를 반환한다.`,
      inputSchema: z
        .object({ lawId: z.string().min(1).describe("법령ID"), response_format: responseFormatSchema })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ lawId, response_format }) => {
      const law = await getLaw(lawId);
      if (!law) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `법령을 찾을 수 없습니다: lawId=${lawId}. law_list_laws로 저장된 lawId 목록을 먼저 확인하세요.`,
            },
          ],
        };
      }

      const rawText =
        response_format === ResponseFormat.JSON
          ? JSON.stringify(law, null, 2)
          : [
              `# ${law.lawName ?? lawId}`,
              "",
              `- 법령ID: ${law.lawId ?? lawId}`,
              `- 구분: ${law.lawType ?? "미상"}`,
              `- 소관부처: ${law.ministry ?? "미상"}`,
              `- 공포일자: ${law.promulgationDate ?? "미상"} (제${law.promulgationNumber ?? "?"}호)`,
              `- 시행일자: ${law.effectiveDate ?? "미상"}`,
              "",
              ...law.articles.map(formatArticleMarkdown),
            ].join("\n");

      const { text, truncated } = truncate(rawText);
      return {
        content: [{ type: "text", text }],
        structuredContent: truncated ? { lawId, truncated: true } : (law as unknown as Record<string, unknown>),
      };
    }
  );

  server.registerTool(
    "law_get_article",
    {
      title: "특정 조문 조회",
      description: `lawId와 조문 번호로 조문 하나를 정확히 조회한다.

Args:
  - lawId (string): 법령ID
  - articleNumber (string): 조문 번호. "1", "제1조" 모두 허용 (내부에서 정규화)
  - response_format ('markdown' | 'json'): 출력 형식 (기본값: markdown)

Returns:
  해당 조문의 제목/본문과 항/호/목 전체.

Error Handling:
  lawId나 조문이 없으면 isError=true와 함께 안내 메시지를 반환한다.`,
      inputSchema: z
        .object({
          lawId: z.string().min(1).describe("법령ID"),
          articleNumber: z.string().min(1).describe("조문 번호 (예: '1' 또는 '제1조')"),
          response_format: responseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ lawId, articleNumber, response_format }) => {
      const normalized = normalizeArticleNumber(articleNumber);
      const article = await getArticle(lawId, normalized);

      if (!article) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `조문을 찾을 수 없습니다: lawId=${lawId}, articleNumber=${articleNumber}. law_get_law로 해당 법령의 조문 번호를 먼저 확인하세요.`,
            },
          ],
        };
      }

      const text = response_format === ResponseFormat.JSON ? JSON.stringify(article, null, 2) : formatArticleMarkdown(article);
      return { content: [{ type: "text", text }], structuredContent: article as unknown as Record<string, unknown> };
    }
  );

  server.registerTool(
    "law_search_articles",
    {
      title: "조문 본문 검색",
      description: `저장된 법령들의 조문 제목/본문/항/호/목 텍스트에서 키워드를 검색한다 (대소문자 무시 단순 포함 검색).

Args:
  - query (string): 검색어 (2자 이상)
  - lawId (string, optional): 특정 법령으로 검색 범위 제한
  - limit (number): 최대 결과 수 (기본 20, 최대 100)
  - offset (number): 페이지네이션 offset (기본 0)
  - response_format ('markdown' | 'json'): 출력 형식 (기본값: markdown)

Returns:
  total/count/offset/has_more/next_offset과 일치한 조문 목록(lawId, lawName, article).`,
      inputSchema: z
        .object({
          query: z.string().min(2, "검색어는 2자 이상이어야 합니다").describe("검색어"),
          lawId: z.string().optional().describe("검색 범위를 좁힐 법령ID (선택)"),
          limit: z.number().int().min(1).max(100).default(20).describe("최대 결과 수"),
          offset: z.number().int().min(0).default(0).describe("페이지네이션 offset"),
          response_format: responseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, lawId, limit, offset, response_format }) => {
      const allHits = await searchArticles(query, lawId);

      if (allHits.length === 0) {
        return {
          content: [{ type: "text", text: `'${query}'와 일치하는 조문이 없습니다.` }],
          structuredContent: { total: 0, count: 0, offset, has_more: false, hits: [] },
        };
      }

      const page = allHits.slice(offset, offset + limit);
      const hasMore = allHits.length > offset + page.length;
      const output = {
        total: allHits.length,
        count: page.length,
        offset,
        has_more: hasMore,
        ...(hasMore ? { next_offset: offset + page.length } : {}),
        hits: page,
      };

      let rawText: string;
      if (response_format === ResponseFormat.JSON) {
        rawText = JSON.stringify(output, null, 2);
      } else {
        const lines = [`# '${query}' 검색 결과 (총 ${allHits.length}건 중 ${page.length}건)`, ""];
        for (const hit of page) {
          lines.push(`## ${hit.lawName ?? hit.lawId}`);
          lines.push(formatArticleMarkdown(hit.article));
          lines.push("");
        }
        if (hasMore) lines.push(`_offset=${offset + page.length} 로 다음 페이지 조회 가능_`);
        rawText = lines.join("\n");
      }

      const { text } = truncate(rawText);
      return { content: [{ type: "text", text }], structuredContent: output };
    }
  );
}
