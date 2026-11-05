#!/usr/bin/env node
/**
 * gyeongbuk-arch-law-mcp-server
 *
 * 경상북도 건축 관련 법령 데이터를 조회하는 로컬(stdio) MCP 서버.
 * data/laws/ 에 미리 파싱해둔 법령 JSON(src/parseLawApi.ts, src/scripts/fetchLaw.ts 참고)을
 * 기반으로 목록 조회 / 상세 조회 / 조문 조회 / 조문 검색 도구를 제공한다.
 * 또한 한국전기안전공사 전기안전정보공개 OpenAPI로 건축물 수전설비 용량을 조회하는 도구(elec_*)를 제공한다.
 */

import "./env.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerElecTools } from "./tools/elecTools.js";
import { registerLawTools } from "./tools/lawTools.js";

const server = new McpServer({
  name: "gyeongbuk-arch-law-mcp-server",
  version: "0.2.0",
});

registerLawTools(server);
registerElecTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("gyeongbuk-arch-law-mcp-server running via stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
