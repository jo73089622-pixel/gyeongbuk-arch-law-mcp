/**
 * 홈페이지 AI 도우미 (Claude API + 도구 호출).
 *
 * - 모델: 기본 claude-opus-5-5 (.env 의 ANTHROPIC_MODEL 로 변경 가능)
 * - 거절(refusal) 대비: 지원 모델에서는 서버 측 예비 모델 전환(fallbacks: "default")을 켠다.
 * - 대화 기록은 이 서버 메모리에만 두며, 도구 호출·사고(thinking) 블록을 포함해 덧붙이기만 한다
 *   (앞선 기록을 고치면 API가 거부할 수 있음). 오류가 나면 그 질문 이전 상태로 되돌린다.
 * - 답변의 사실 근거는 search_receiving_capacity 도구 결과뿐이며, 없으면 "확인되지 않습니다"로 답하게 한다.
 */

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { KesApiError } from "../elec/kescoClient.js";
import { listSigungu, resolveSido, SIDO_LIST } from "../elec/regions.js";
import {
  CATEGORY_OPTIONS,
  defaultMonths,
  MAX_MONTHS,
  searchReceivingCapacity,
  SearchInputError,
  type SearchResult,
} from "../elec/service.js";
import { LEGAL_BASIS, LIMITATIONS, OFFICIAL_LOOKUP_URL, UNVERIFIED_ITEMS } from "../elec/sources.js";
import { RECEIVING_UNIT_NOTE } from "../elec/types.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

/** 서버 측 예비 모델 전환(fallbacks: "default")을 받는 모델 */
const FALLBACK_CAPABLE_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const MAX_TOOL_ROUNDS = 6;
const MAX_TURNS_PER_SESSION = 20;
const MAX_SESSIONS = 50;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CHAT_RESULT_LIMIT_DEFAULT = 20;
const CHAT_RESULT_LIMIT_MAX = 50;

export class ChatError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export function chatModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

function chatEffort(): Effort {
  const value = process.env.ANTHROPIC_EFFORT?.trim() as Effort | undefined;
  return value && EFFORT_LEVELS.includes(value) ? value : "medium";
}

export function hasClaudeCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

const SYSTEM_PROMPT = [
  "당신은 경상북도 공공기관 실무자를 돕는 '건축물 수전설비 용량 조회' 도우미입니다.",
  "",
  "[답변 원칙]",
  "1. 수전설비의 용량·전압·검사 기록에 관한 사실은 반드시 search_receiving_capacity 도구 결과에서만 가져옵니다. 도구 결과에 없는 수치·상호·주소·날짜를 만들거나 추정하지 않습니다.",
  `2. 도구 결과가 0건이거나 오류이면 "확인되지 않습니다"라고 분명히 말하고, 지역·기간·검색어를 바꿔 보도록 안내하며, 공식 확인처(전기안전종합정보시스템 「검사·점검이력정보」 ${OFFICIAL_LOOKUP_URL})를 알려 줍니다.`,
  "3. 어느 시군구인지 알 수 없으면 조회하지 말고 먼저 묻습니다. 전국을 조회할 수 있으며, '중구'처럼 여러 시도에 있는 이름은 시도를 붙여(예: 서울 중구) 조회합니다. 시도를 밝히지 않으면 경상북도로 가정하지 말고 확인합니다.",
  "4. 답변 맨 앞에 '핵심 결론'(상호, 소재지, 수전용량 kW, 수전전압 V, 검사일, 검사종류)을 두고, 그 아래에 근거(출처, 조회기간, 단위 근거)를 적습니다.",
  "5. 결과가 여러 건이고 질문한 건물이 어느 것인지 확실하지 않으면 후보를 나열하고 사용자에게 확인을 요청합니다. 임의로 하나를 골라 단정하지 않습니다.",
  "6. 상호명이 일부 가려져 있거나 주소에 번지가 없으면, 질문한 건물과 같은 시설인지 단정할 수 없다고 밝힙니다.",
  "7. 개인 성명은 다루지 않습니다(도구 결과에도 들어 있지 않습니다).",
  '8. 법령은 아래 [법적 근거]에 적힌 범위에서만 인용하고, 그 밖의 법률 판단은 "이 부분은 명확한 확인이 어렵습니다"라고 답합니다.',
  "9. 정중하고 건조하며 명확한 공문서 어조로, 비전문가도 이해하기 쉽게 씁니다. 화면이 마크다운을 표시하지 않으므로 #, **, | 같은 기호와 표는 쓰지 말고 짧은 문단과 '-' 목록으로 씁니다.",
  "10. 처음 조회하는 지역·기간은 한 달에 1회씩 API를 호출해 시간이 걸립니다. 필요한 만큼만 조회합니다.",
  "",
  `[단위 근거] ${RECEIVING_UNIT_NOTE}`,
  "",
  "[법적 근거]",
  ...LEGAL_BASIS.map((l) => `- ${l}`),
  "",
  "[자료의 한계]",
  ...LIMITATIONS.map((l) => `- ${l}`),
  "",
  "[확인 필요 사항 — 실제 응답으로 아직 확인되지 않음]",
  ...UNVERIFIED_ITEMS.map((l) => `- ${l}`),
  "",
  `[시도] ${SIDO_LIST.map((s) => s.name).join(", ")} — 시군구 목록은 list_regions 도구로 확인합니다.`,
].join("\n");

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_receiving_capacity",
    description:
      "한국전기안전공사 전기안전정보공개 OpenAPI(검사점검이력정보)에서 시군 단위로 최근 N개월의 검사 기록을 받아 " +
      "상호·주소 검색어로 걸러, 시설의 수전전압(V)·수전용량(kW)과 검사일·검사종류·결과를 돌려준다. " +
      "결과가 0건이면 해당 조건의 기록이 없다는 뜻이다. 개인 성명은 포함하지 않는다.",
    input_schema: {
      type: "object",
      properties: {
        sigungu: { type: "string", description: "시도+시군구 이름(예: 경북 구미시, 경기 수원시 장안구) 또는 5자리 시군구코드(예: 47190)" },
        keyword: {
          type: "string",
          description: "상호·주소 검색어. 공백으로 나눈 낱말을 모두 포함하는 기록만 찾는다. 번지는 응답에 없을 수 있다.",
        },
        months: {
          type: "integer",
          minimum: 1,
          maximum: MAX_MONTHS,
          description: `최근 몇 개월을 조회할지 (이번 달 포함, 기본 ${defaultMonths()})`,
        },
        category: {
          type: "string",
          enum: [...CATEGORY_OPTIONS],
          description: "검사점검설비용도구분 (기본 자가용 — 수전설비 사용전검사·정기검사 대상)",
        },
        latest_only: { type: "boolean", description: "같은 상호·주소·호기번호는 최신 1건만 (기본 true)" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: CHAT_RESULT_LIMIT_MAX,
          description: `최대 건수 (기본 ${CHAT_RESULT_LIMIT_DEFAULT})`,
        },
      },
      required: ["sigungu"],
      additionalProperties: false,
    },
  },
  {
    name: "list_regions",
    description: "시도의 시군구 이름과 5자리 시군구코드 목록을 돌려준다. sido 없이 부르면 시도 목록을 돌려준다.",
    input_schema: {
      type: "object",
      properties: { sido: { type: "string", description: "시도 이름(예: 경기, 경상북도) 또는 2자리 코드" } },
      additionalProperties: false,
    },
  },
];

const SearchInput = z
  .object({
    sigungu: z.string().min(1).max(50),
    keyword: z.string().max(100).optional(),
    months: z.number().int().min(1).max(MAX_MONTHS).optional(),
    category: z.enum(CATEGORY_OPTIONS).optional(),
    latest_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(CHAT_RESULT_LIMIT_MAX).optional(),
  })
  .strict();

/** 모델에 넘길 간결한 결과 (불필요한 필드는 빼서 토큰을 아낀다) */
function compactResult(result: SearchResult): Record<string, unknown> {
  return {
    지역: result.region.name,
    조회기간: `${result.period.from}~${result.period.to} (${result.period.months}개월)`,
    조건: result.query,
    건수: result.counts,
    받지못한달: result.failedMonths,
    안내문구가온달: result.monthMessages,
    기록: result.records.map((r) => ({
      상호: r.businessName,
      도로명주소: r.roadAddress,
      지번주소: r.lotAddress,
      호기번호: r.unitNo,
      구분: r.category,
      검사점검타입: r.inspectionType,
      검사점검종류: r.inspectionKind,
      설비타입: r.equipmentType,
      수전전압_V: r.receivingVoltageV ?? r.raw.receivingVoltage,
      수전용량_kW: r.receivingCapacityKw ?? r.raw.receivingCapacity,
      발전전압_V: r.generationVoltageV ?? r.raw.generationVoltage,
      발전용량_kW: r.generationCapacityKw ?? r.raw.generationCapacity,
      전압_V: r.voltageV ?? r.raw.voltage,
      용량_kW: r.capacityKw ?? r.raw.capacity,
      검사시작일: r.inspectionStart,
      검사종료일: r.inspectionEnd,
      결과: r.result,
      안전등급: r.safetyGrade,
      업종: r.industry,
      조회연월: r.sourceMonth,
    })),
    유의사항: result.notes,
  };
}

export interface ToolCallSummary {
  name: string;
  summary: string;
  ok: boolean;
}

type SearchFn = typeof searchReceivingCapacity;

async function runTool(
  block: Anthropic.Beta.BetaToolUseBlock,
  calls: ToolCallSummary[],
  search: SearchFn
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  if (block.name === "list_regions") {
    const sidoInput = (block.input as { sido?: unknown }).sido;
    const code = typeof sidoInput === "string" ? resolveSido(sidoInput) : undefined;
    calls.push({ name: block.name, summary: `지역 목록 확인${code ? ` (${sidoInput})` : ""}`, ok: true });
    const content = code
      ? listSigungu(code).map((s) => ({ 이름: s.name, 시군구코드: s.code, 유의사항: s.note ?? null }))
      : SIDO_LIST.map((s) => ({ 시도: s.name, 코드: s.code }));
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(content) };
  }

  if (block.name !== "search_receiving_capacity") {
    calls.push({ name: block.name, summary: "알 수 없는 도구", ok: false });
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `알 수 없는 도구입니다: ${block.name}` };
  }

  const parsed = SearchInput.safeParse(block.input);
  if (!parsed.success) {
    calls.push({ name: block.name, summary: "입력값 오류", ok: false });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: `입력값이 올바르지 않습니다: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    };
  }

  const input = parsed.data;
  const summary = `${input.sigungu} · ${input.months ?? defaultMonths()}개월 · ${input.category ?? "자가용"}${input.keyword ? ` · "${input.keyword}"` : ""}`;
  try {
    const result = await search({
      sigungu: input.sigungu,
      keyword: input.keyword,
      months: input.months,
      category: input.category,
      latestOnly: input.latest_only,
      limit: input.limit ?? CHAT_RESULT_LIMIT_DEFAULT,
    });
    calls.push({ name: block.name, summary: `${summary} → ${result.counts.returnedRecords}건`, ok: true });
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(compactResult(result)) };
  } catch (err) {
    const message =
      err instanceof SearchInputError || err instanceof KesApiError ? err.message : `조회 중 오류: ${(err as Error).message}`;
    calls.push({ name: block.name, summary: `${summary} → 오류`, ok: false });
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: message };
  }
}

interface ChatSession {
  messages: Anthropic.Beta.BetaMessageParam[];
  turns: number;
  updatedAt: number;
  busy: boolean;
}

const sessions = new Map<string, ChatSession>();

function pruneSessions(now: number): void {
  for (const [id, s] of sessions) {
    if (!s.busy && now - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].filter(([, s]) => !s.busy).sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (!oldest) break;
    sessions.delete(oldest[0]);
  }
}

export function resetSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s && !s.busy) sessions.delete(sessionId);
}

export interface ChatReply {
  sessionId: string;
  answer: string;
  toolCalls: ToolCallSummary[];
  usage: { requests: number; inputTokens: number; outputTokens: number };
  model: string;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    try {
      client = new Anthropic();
    } catch {
      throw new ChatError(503, "Claude API 키가 설정되지 않았습니다. .env 파일의 ANTHROPIC_API_KEY를 확인하십시오.");
    }
  }
  return client;
}

function toChatError(err: unknown): ChatError {
  if (err instanceof ChatError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new ChatError(502, "Claude API 인증에 실패했습니다. .env 파일의 ANTHROPIC_API_KEY를 확인하십시오.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new ChatError(502, "이 API 키로는 선택한 모델을 쓸 권한이 없습니다. ANTHROPIC_MODEL 또는 키 권한을 확인하십시오.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ChatError(429, "Claude API 요청 한도를 넘었습니다. 잠시 후 다시 시도하십시오.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ChatError(502, `Claude API가 요청을 거부했습니다: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ChatError(502, "Claude API에 연결하지 못했습니다. 인터넷 연결 또는 사내 프록시 설정(README 참고)을 확인하십시오.");
  }
  if (err instanceof Anthropic.APIError) {
    return new ChatError(502, `Claude API 오류가 발생했습니다(HTTP ${err.status ?? "?"}). 잠시 후 다시 시도하십시오.`);
  }
  return new ChatError(500, `처리 중 오류가 발생했습니다: ${(err as Error).message}`);
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** 시험할 때 Claude API·조회 함수를 바꿔 끼우기 위한 의존성 */
export interface ChatDeps {
  createMessage?: (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;
  search?: SearchFn;
}

export async function handleChat(input: { sessionId?: string; message: string }, deps: ChatDeps = {}): Promise<ChatReply> {
  const message = input.message.trim();
  if (!message) throw new ChatError(400, "질문을 입력하십시오.");
  if (message.length > 2000) throw new ChatError(400, "질문은 2,000자 이내로 입력하십시오.");
  const search = deps.search ?? searchReceivingCapacity;

  const now = Date.now();
  pruneSessions(now);
  const sessionId = input.sessionId && sessions.has(input.sessionId) ? input.sessionId : randomUUID();
  const session = sessions.get(sessionId) ?? { messages: [], turns: 0, updatedAt: now, busy: false };
  sessions.set(sessionId, session);

  if (!deps.createMessage && !hasClaudeCredentials()) {
    throw new ChatError(503, "Claude API 키가 설정되지 않아 AI 도우미를 쓸 수 없습니다. .env 파일의 ANTHROPIC_API_KEY를 설정한 뒤 서버를 다시 시작하십시오.");
  }
  if (session.busy) throw new ChatError(409, "앞선 질문의 답변을 작성하고 있습니다. 잠시 후 다시 보내십시오.");
  if (session.turns >= MAX_TURNS_PER_SESSION) {
    throw new ChatError(400, `한 대화에서 질문은 ${MAX_TURNS_PER_SESSION}개까지입니다. '새 대화'를 눌러 다시 시작하십시오.`);
  }

  const createMessage =
    deps.createMessage ??
    ((params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => getClient().beta.messages.create(params));
  const model = chatModel();
  const effort = chatEffort();
  const fallbackParams = FALLBACK_CAPABLE_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  session.busy = true;
  const turnStart = session.messages.length;
  const toolCalls: ToolCallSummary[] = [];
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  session.messages.push({ role: "user", content: message });

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const response = await createMessage({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: session.messages,
        output_config: { effort },
        ...fallbackParams,
      });
      usage.requests += 1;
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      if (response.stop_reason === "refusal") {
        session.messages.length = turnStart;
        return {
          sessionId,
          answer: "죄송합니다. 이 질문은 처리할 수 없습니다. 질문을 바꾸어 다시 입력하여 주십시오.",
          toolCalls,
          usage,
          model,
        };
      }
      if (response.stop_reason === "max_tokens") {
        throw new ChatError(502, "답변이 너무 길어 중단되었습니다. 질문을 나누어 다시 입력하십시오.");
      }

      session.messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "pause_turn") continue;

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        session.turns += 1;
        session.updatedAt = Date.now();
        return { sessionId, answer: textOf(response.content) || "(답변이 비어 있습니다.)", toolCalls, usage, model };
      }
      if (round === MAX_TOOL_ROUNDS) break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of toolUses) results.push(await runTool(block, toolCalls, search));
      session.messages.push({ role: "user", content: results });
    }
    throw new ChatError(502, "조회를 너무 여러 번 반복해 중단했습니다. 시군과 상호를 구체적으로 적어 다시 질문하십시오.");
  } catch (err) {
    session.messages.length = turnStart; // 이 질문 이전 상태로 되돌림
    throw toChatError(err);
  } finally {
    session.busy = false;
    session.updatedAt = Date.now();
  }
}
