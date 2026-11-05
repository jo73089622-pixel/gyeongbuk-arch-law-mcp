import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createServer, HOST, isAllowedHost, isAllowedOrigin } from "./server.js";

test("이 PC 주소로 들어온 요청만 받는다", () => {
  assert.equal(isAllowedHost("127.0.0.1:3000", 3000), true);
  assert.equal(isAllowedHost("localhost:3000", 3000), true);
  assert.equal(isAllowedHost("evil.example:3000", 3000), false);
  assert.equal(isAllowedHost("127.0.0.1:3001", 3000), false);
  assert.equal(isAllowedHost(undefined, 3000), false);
  assert.equal(isAllowedOrigin(undefined, 3000), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:3000", 3000), true);
  assert.equal(isAllowedOrigin("http://evil.example", 3000), false);
});

const server = createServer();
let base = "";

before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

test("첫 화면과 설정 정보를 보낸다 (인증키 값은 보내지 않음)", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.regions.length, 22);
  assert.equal(typeof status.kescoKeyConfigured, "boolean");
  assert.equal(JSON.stringify(status).includes(process.env.KESCO_API_KEY || "@@없음@@"), false);
});

test("다른 사이트의 요청과 허용되지 않은 주소·형식을 막는다", async () => {
  const origin = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(origin.status, 403);

  const type = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
  assert.equal(type.status, 415);

  const notFound = await fetch(`${base}/package.json`);
  assert.equal(notFound.status, 404);
});

test("Claude API 키가 없으면 AI 도우미는 503과 안내 문구를 돌려준다", async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "구미시 수전용량" }),
  });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
});

test("조회는 Server-Sent Events로 결과나 실패를 알린다", async () => {
  const res = await fetch(`${base}/api/search?sigungu=99999&months=1`);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /event: failure/);
  assert.match(text, /지역을 찾지 못했습니다/);
});
