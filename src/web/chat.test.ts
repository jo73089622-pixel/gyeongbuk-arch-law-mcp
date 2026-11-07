import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { PROJECT_ROOT } from "../config.js";
import { searchReceivingCapacity, type SearchParams } from "../elec/service.js";
import type { KesRawRecord } from "../elec/types.js";
import { ChatError, handleChat } from "./chat.js";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Msg = Anthropic.Beta.BetaMessage;

// 명세 예시값(실제 응답 아님)
const sample = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "fixtures", "kesco-spec-sample-record.json"), "utf-8"))
  .record as KesRawRecord;

function fakeSearch(params: SearchParams) {
  return searchReceivingCapacity(params, {
    apiKey: "K",
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), "chat-cache-")),
    now: new Date("2026-11-05T03:00:00Z"),
    delayMs: 0,
    fetchMonth: async (q) => ({
      records: q.searchYM === "202611" ? [{ ...sample, CMPNM: "가나병원", TRANSELE_CPCTY: "1500" }] : [],
      envelopePath: "result",
      message: null,
    }),
  });
}

function message(stop: Msg["stop_reason"], content: unknown[]): Msg {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: stop,
    content,
    usage: { input_tokens: 100, output_tokens: 20 },
  } as unknown as Msg;
}

function scripted(responses: Msg[], seen: Params[]) {
  return async (params: Params): Promise<Msg> => {
    seen.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("예상보다 많이 호출됨");
    return next;
  };
}

test("도구로 조회한 뒤 답하고, 모델·사고 깊이·예비 모델 전환을 설정해 보낸다", async () => {
  delete process.env.ANTHROPIC_MODEL;
  const seen: Params[] = [];
  const toolUse = { type: "tool_use", id: "tu_1", name: "search_receiving_capacity", input: { sigungu: "구미시", keyword: "가나", months: 2 } };
  const reply = await handleChat(
    { message: "구미시 가나병원 수전용량은?" },
    {
      search: fakeSearch,
      createMessage: scripted([message("tool_use", [toolUse]), message("end_turn", [{ type: "text", text: "핵심 결론: 1,500kW" }])], seen),
    }
  );
  assert.equal(reply.answer, "핵심 결론: 1,500kW");
  assert.equal(reply.toolCalls.length, 1);
  assert.equal(reply.toolCalls[0].ok, true);
  assert.match(reply.toolCalls[0].summary, /구미시 · 2개월 · 자가용 · "가나" → 1건/);
  assert.deepEqual(reply.usage, { requests: 2, inputTokens: 200, outputTokens: 40 });

  const first = seen[0] as Params & { fallbacks?: unknown };
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.output_config?.effort, "medium");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.tools?.map((t) => (t as { name: string }).name), ["search_receiving_capacity", "list_regions"]);

  // 두 번째 요청: 앞선 assistant 응답을 그대로 붙이고, 도구 결과를 user 메시지로 보낸다
  const second = seen[1];
  assert.equal(second.messages.length, 3);
  assert.deepEqual(second.messages[1], { role: "assistant", content: [toolUse] });
  const toolResult = (second.messages[2].content as Array<{ type: string; tool_use_id: string; content: string }>)[0];
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "tu_1");
  const payload = JSON.parse(toolResult.content);
  assert.equal(payload.기록[0].상호, "가나병원");
  assert.equal(payload.기록[0].수전용량_kW, 1500);
  assert.equal(toolResult.content.includes("대**"), false);
});

test("같은 대화의 다음 질문은 앞선 기록을 고치지 않고 덧붙여 보낸다", async () => {
  const seen: Params[] = [];
  const createMessage = scripted(
    [message("end_turn", [{ type: "text", text: "첫 답" }]), message("end_turn", [{ type: "text", text: "둘째 답" }])],
    seen
  );
  const a = await handleChat({ message: "첫 질문" }, { createMessage, search: fakeSearch });
  const b = await handleChat({ sessionId: a.sessionId, message: "둘째 질문" }, { createMessage, search: fakeSearch });
  assert.equal(b.sessionId, a.sessionId);
  assert.deepEqual(seen[1].messages.slice(0, 2), seen[0].messages.concat([{ role: "assistant", content: [{ type: "text", text: "첫 답" }] }]));
  assert.equal(seen[1].messages.length, 3);
});

test("거절(refusal)이나 오류가 나면 그 질문 이전 상태로 되돌린다", async () => {
  const seen: Params[] = [];
  const createMessage = scripted(
    [
      message("end_turn", [{ type: "text", text: "첫 답" }]),
      message("refusal", []),
      message("end_turn", [{ type: "text", text: "셋째 답" }]),
    ],
    seen
  );
  const a = await handleChat({ message: "첫 질문" }, { createMessage, search: fakeSearch });
  const refused = await handleChat({ sessionId: a.sessionId, message: "둘째 질문" }, { createMessage, search: fakeSearch });
  assert.match(refused.answer, /처리할 수 없습니다/);
  await handleChat({ sessionId: a.sessionId, message: "셋째 질문" }, { createMessage, search: fakeSearch });
  // 셋째 요청에는 거절된 둘째 질문이 남아 있지 않다
  assert.deepEqual(
    seen[2].messages.map((m) => (typeof m.content === "string" ? m.content : m.role)),
    ["첫 질문", "assistant", "셋째 질문"]
  );

  const failing = async (): Promise<Msg> => {
    throw new Error("시험용 오류");
  };
  await assert.rejects(handleChat({ sessionId: a.sessionId, message: "넷째 질문" }, { createMessage: failing }), ChatError);
});

test("도구 입력값이 범위를 벗어나면 오류 결과를 돌려주고 계속 진행한다", async () => {
  const seen: Params[] = [];
  const bad = { type: "tool_use", id: "tu_bad", name: "search_receiving_capacity", input: { sigungu: "구미시", months: 999 } };
  const reply = await handleChat(
    { message: "구미시 전체" },
    {
      search: fakeSearch,
      createMessage: scripted([message("tool_use", [bad]), message("end_turn", [{ type: "text", text: "확인되지 않습니다" }])], seen),
    }
  );
  assert.equal(reply.toolCalls[0].ok, false);
  const result = (seen[1].messages[2].content as Array<{ is_error?: boolean }>)[0];
  assert.equal(result.is_error, true);
});

test("예비 모델 전환을 받지 않는 모델에는 해당 변수를 보내지 않는다", async () => {
  process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";
  try {
    const seen: Params[] = [];
    await handleChat(
      { message: "안녕하세요" },
      { search: fakeSearch, createMessage: scripted([message("end_turn", [{ type: "text", text: "네" }])], seen) }
    );
    const p = seen[0] as Params & { fallbacks?: unknown };
    assert.equal(p.model, "claude-haiku-5-5");
    assert.equal(p.fallbacks, undefined);
    assert.equal(p.betas, undefined);
  } finally {
    delete process.env.ANTHROPIC_MODEL;
  }
});

test("빈 질문·너무 긴 질문은 받지 않는다", async () => {
  await assert.rejects(handleChat({ message: "   " }, { createMessage: async () => message("end_turn", []) }), ChatError);
  await assert.rejects(handleChat({ message: "가".repeat(2001) }, { createMessage: async () => message("end_turn", []) }), ChatError);
});

test("AI 도우미는 최대 200건까지 받고, 201건은 입력 오류로 돌려준다", async () => {
  for (const [limit, ok] of [[200, true], [201, false]] as const) {
    const seen: Params[] = [];
    const tu = { type: "tool_use", id: "tu_lim", name: "search_receiving_capacity", input: { sigungu: "구미시", months: 1, limit } };
    const reply = await handleChat(
      { message: "구미시 전체 목록" },
      { search: fakeSearch, createMessage: scripted([message("tool_use", [tu]), message("end_turn", [{ type: "text", text: "끝" }])], seen) }
    );
    assert.equal(reply.toolCalls[0].ok, ok, String(limit));
  }
});
