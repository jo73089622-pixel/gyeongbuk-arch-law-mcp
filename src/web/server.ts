#!/usr/bin/env node
/**
 * 건축물 수전설비 용량 조회 홈페이지 서버.
 *
 * - 이 PC에서만 접속할 수 있도록 127.0.0.1 에만 연다 (합의 사항: 실행한 PC에서만 접속).
 * - 다른 웹사이트가 이 서버로 요청을 보내지 못하도록 Host·Origin 머리글을 검사한다.
 * - 인증키(KESCO_API_KEY, ANTHROPIC_API_KEY)는 서버에만 두고 브라우저로 보내지 않는다.
 *
 * 실행: npm run build && npm run web  → http://127.0.0.1:3000
 */

import "../env.js";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_ROOT } from "../config.js";
import { KesApiError } from "../elec/kescoClient.js";
import { GYEONGBUK_SIGUNGU } from "../elec/regions.js";
import {
  CATEGORY_OPTIONS,
  defaultMonths,
  MAX_LIMIT,
  MAX_MONTHS,
  searchReceivingCapacity,
  SearchInputError,
  type CategoryOption,
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
import { hasKescoApiKey } from "../env.js";
import { ChatError, chatModel, handleChat, hasClaudeCredentials, resetSession } from "./chat.js";

export const HOST = "127.0.0.1";
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const MAX_BODY_BYTES = 32 * 1024;
const MAX_CONCURRENT_SEARCHES = 3;

const STATIC_FILES: Readonly<Record<string, { file: string; type: string }>> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/** DNS 재바인딩 공격을 막기 위해 이 PC 주소로 들어온 요청만 받는다. */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  return hostHeader !== undefined && allowedHosts(port).includes(hostHeader.toLowerCase());
}

/** 다른 웹사이트에서 보낸 요청(Origin이 다른 경우)은 거부한다. Origin이 없으면(직접 호출) 허용. */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return allowedHosts(port).some((h) => origin.toLowerCase() === `http://${h}`);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ChatError(415, "Content-Type은 application/json 이어야 합니다.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ChatError(413, "요청 내용이 너무 큽니다.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new ChatError(400, "요청 내용이 올바른 JSON이 아닙니다.");
  }
}

function statusPayload() {
  return {
    kescoKeyConfigured: hasKescoApiKey(),
    claudeKeyConfigured: hasClaudeCredentials(),
    model: chatModel(),
    defaultMonths: defaultMonths(),
    maxMonths: MAX_MONTHS,
    categories: CATEGORY_OPTIONS,
    regions: GYEONGBUK_SIGUNGU,
    legalBasis: LEGAL_BASIS,
    dataSources: DATA_SOURCE_LINES,
    limitations: LIMITATIONS,
    unverified: UNVERIFIED_ITEMS,
    unitNote: RECEIVING_UNIT_NOTE,
    links: { officialLookup: OFFICIAL_LOOKUP_URL, openApiIntro: OPENAPI_INTRO_URL, openApiApply: OPENAPI_APPLY_URL },
  };
}

let activeSearches = 0;

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "1" || value === "true";
}

function parseIntParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** GET /api/search — 진행률과 결과를 Server-Sent Events로 보낸다. */
async function handleSearch(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (activeSearches >= MAX_CONCURRENT_SEARCHES) {
    send("failure", { message: "다른 조회가 진행 중입니다. 잠시 후 다시 시도하십시오." });
    res.end();
    return;
  }

  const categoryParam = url.searchParams.get("category");
  const category = (CATEGORY_OPTIONS as readonly string[]).includes(categoryParam ?? "")
    ? (categoryParam as CategoryOption)
    : undefined;

  const controller = new AbortController();
  // 응답 스트림이 닫히면(브라우저에서 '중지'·창 닫기) 남은 달의 조회를 멈춘다.
  res.on("close", () => controller.abort());
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(": keep-alive\n\n");
  }, 15_000);

  activeSearches += 1;
  try {
    const result = await searchReceivingCapacity(
      {
        sigungu: url.searchParams.get("sigungu") ?? "",
        keyword: url.searchParams.get("keyword") ?? undefined,
        months: parseIntParam(url.searchParams.get("months")),
        category,
        latestOnly: parseBool(url.searchParams.get("latestOnly"), true),
        refresh: parseBool(url.searchParams.get("refresh"), false),
        limit: Math.min(parseIntParam(url.searchParams.get("limit")) ?? 200, MAX_LIMIT),
      },
      { signal: controller.signal, onProgress: (p) => send("progress", p) }
    );
    send("result", result);
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      const message =
        err instanceof SearchInputError || err instanceof KesApiError
          ? err.message
          : `조회 중 오류가 발생했습니다: ${(err as Error).message}`;
      send("failure", { message });
    }
  } finally {
    activeSearches -= 1;
    clearInterval(keepAlive);
    res.end();
  }
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, port: number): Promise<void> {
  if (!isAllowedHost(req.headers.host, port)) {
    sendJson(res, 421, { error: "이 서버는 이 PC(127.0.0.1)에서만 접속할 수 있습니다." });
    return;
  }
  if (!isAllowedOrigin(req.headers.origin, port)) {
    sendJson(res, 403, { error: "다른 사이트에서 보낸 요청은 받지 않습니다." });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const method = req.method ?? "GET";

  const staticFile = STATIC_FILES[url.pathname];
  if (staticFile) {
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { error: "허용되지 않은 요청 방식입니다." });
      return;
    }
    const body = await fs.readFile(path.join(PUBLIC_DIR, staticFile.file));
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": staticFile.type, "Cache-Control": "no-cache" });
    res.end(method === "HEAD" ? undefined : body);
    return;
  }

  if (url.pathname === "/api/status" && method === "GET") {
    sendJson(res, 200, statusPayload());
    return;
  }
  if (url.pathname === "/api/search" && method === "GET") {
    await handleSearch(req, res, url);
    return;
  }
  if (url.pathname === "/api/chat" && method === "POST") {
    try {
      const body = (await readJsonBody(req)) as { sessionId?: unknown; message?: unknown };
      if (typeof body.message !== "string") throw new ChatError(400, "message(질문)가 필요합니다.");
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
      sendJson(res, 200, await handleChat({ sessionId, message: body.message }));
    } catch (err) {
      const e = err instanceof ChatError ? err : new ChatError(500, (err as Error).message);
      sendJson(res, e.status, { error: e.message });
    }
    return;
  }
  if (url.pathname === "/api/chat/reset" && method === "POST") {
    try {
      const body = (await readJsonBody(req)) as { sessionId?: unknown };
      if (typeof body.sessionId === "string") resetSession(body.sessionId);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const e = err instanceof ChatError ? err : new ChatError(500, (err as Error).message);
      sendJson(res, e.status, { error: e.message });
    }
    return;
  }

  sendJson(res, 404, { error: "찾을 수 없는 주소입니다." });
}

export function createServer(): http.Server {
  const server = http.createServer((req, res) => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    route(req, res, port).catch((err) => {
      console.error("요청 처리 오류:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "서버 내부 오류가 발생했습니다." });
      else res.end();
    });
  });
  // 긴 조회(수십 개월)는 응답을 보내는 동안 15초마다 keep-alive 주석을 보내 연결을 유지한다(handleSearch 참고).
  return server;
}

function resolvePort(): number {
  const n = Number(process.env.PORT ?? 3000);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3000;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = resolvePort();
  const server = createServer();
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`포트 ${port}을(를) 다른 프로그램이 쓰고 있습니다. .env 파일에서 PORT를 바꾸십시오.`);
    } else {
      console.error("서버 시작 오류:", err.message);
    }
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`수전설비 용량 조회 홈페이지: http://${HOST}:${port}  (이 PC에서만 접속 가능)`);
    if (!hasKescoApiKey()) console.log("※ KESCO_API_KEY가 없어 새 자료를 받을 수 없습니다(.env 설정 필요).");
    if (!hasClaudeCredentials()) console.log("※ ANTHROPIC_API_KEY가 없어 AI 도우미를 쓸 수 없습니다(.env 설정 필요).");
  });
}
