/**
 * 실제 인증키로 전기안전정보공개 OpenAPI 응답을 검증한다 (사용자 PC에서 실행).
 *
 *   npm run kesco:verify            (사내 프록시: npm run kesco:verify:proxy)
 *   npm run kesco:verify -- --month 202510   (조회연월 지정, 기본: 지난달)
 *
 * - 실제 API를 최대 7회 호출한다 (구미시 1~3회, 포항 구군코드 3가지 × 1회, 필요 시 1회).
 * - 화면에 출력하는 요약에는 인증키·상호명·주소·성명 원문이 없다(모양과 건수만).
 *   이 요약을 그대로 복사해 전달하면 된다.
 * - 원본 응답은 data/kesco/verify/ 에만 저장한다(저장소에 올라가지 않음, 개인정보가 있을 수 있으니 공유 금지).
 */

import "../env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import { KES_OPENAPI_URL, KesApiError, parseKesResponse } from "../elec/kescoClient.js";
import { recentMonthsKst } from "../elec/service.js";
import { describeShape, summarizeRecords } from "../elec/verify.js";

const OUT_DIR = path.join(DATA_DIR, "kesco", "verify");

interface CallReport {
  label: string;
  query: { service: string; searchYM: string; sido: string; gugun: string };
  httpStatus: number | null;
  responseBytes: number;
  topLevelShape: unknown;
  parse: { ok: boolean; envelopePath?: string | null; message?: string | null; error?: string };
  summary?: ReturnType<typeof summarizeRecords>;
  /** 주소에 각 구 이름이 들어간 기록 수 (--regions) */
  districtCounts?: Record<string, number>;
  savedRaw?: string;
}

function parseArgs(argv: string[]): { month?: string; regions: boolean } {
  const i = argv.indexOf("--month");
  return { ...(i >= 0 ? { month: argv[i + 1] } : {}), regions: argv.includes("--regions") };
}

async function call(apiKey: string, label: string, searchYM: string, sido: string, gugun: string, districts: string[] = []): Promise<CallReport> {
  const url = new URL(KES_OPENAPI_URL);
  url.searchParams.set("codeNo", apiKey);
  url.searchParams.set("service", "inspctResultInfo");
  url.searchParams.set("searchYM", searchYM);
  url.searchParams.set("sido", sido);
  url.searchParams.set("gugun", gugun);
  const report: CallReport = {
    label,
    query: { service: "inspctResultInfo", searchYM, sido, gugun },
    httpStatus: null,
    responseBytes: 0,
    topLevelShape: null,
    parse: { ok: false },
  };
  let text = "";
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      report.httpStatus = res.status;
      text = await res.text();
      break;
    } catch (err) {
      const reason = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000)); // 일시적 연결 끊김에 대비해 1회만 다시 시도
        continue;
      }
      report.parse = { ok: false, error: `연결 실패(2회 시도): ${reason}` };
      return report;
    }
  }
  report.responseBytes = Buffer.byteLength(text);
  const file = path.join(OUT_DIR, `${label}-${searchYM}-${sido}${gugun}.json`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(file, text, "utf-8");
  report.savedRaw = path.relative(process.cwd(), file);
  try {
    report.topLevelShape = describeShape(JSON.parse(text));
  } catch {
    report.topLevelShape = `JSON 아님 (앞부분 모양: ${text.slice(0, 80).replace(/[가-힣A-Za-z0-9]/g, "○")})`;
  }
  try {
    const parsed = parseKesResponse(text);
    report.parse = { ok: true, envelopePath: parsed.envelopePath, message: parsed.message };
    if (parsed.records.length > 0) report.summary = summarizeRecords(parsed.records);
    if (districts.length > 0) {
      const addrs = parsed.records.map((r) => {
        const n = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(), v]));
        return `${n.LNM_ADRES ?? ""} ${n.RN_ADRES ?? ""}`;
      });
      report.districtCounts = Object.fromEntries(districts.map((d) => [d, addrs.filter((a) => a.includes(d)).length]));
    }
  } catch (err) {
    report.parse = { ok: false, error: err instanceof KesApiError ? `${err.kind}: ${err.message.slice(0, 120)}` : (err as Error).message };
  }
  return report;
}

async function main(): Promise<void> {
  const apiKey = process.env.KESCO_API_KEY?.trim();
  if (!apiKey) {
    console.error(".env 파일의 KESCO_API_KEY가 비어 있습니다. 발급받은 인증키를 넣은 뒤 다시 실행하십시오.");
    process.exitCode = 1;
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const { month } = args;
  if (month !== undefined && !/^\d{6}$/.test(month)) {
    console.error("--month 는 YYYYMM 형식이어야 합니다 (예: 202510).");
    process.exitCode = 1;
    return;
  }
  const recent = recentMonthsKst(new Date(), 4);
  if (args.regions) {
    await verifyRegions(apiKey, args.month ?? recent[1]);
    return;
  }
  const months = month ? [month] : [recent[1], recent[2], recent[3]]; // 지난달부터 (이번 달은 입력이 덜 됐을 수 있음)

  const reports: CallReport[] = [];
  // 1) 구미시: 자료가 나오는 달을 찾을 때까지 최대 3개월
  let gumiMonth = months[0];
  for (const m of months) {
    const r = await call(apiKey, "gumi", m, "47", "19");
    reports.push(r);
    gumiMonth = m;
    if (r.parse.ok === false && r.parse.error?.startsWith("auth")) break;
    if ((r.summary?.records ?? 0) > 0) break;
  }
  const authFailed = reports.some((r) => r.parse.error?.startsWith("auth"));
  // 2) 포항: 명세 형식(2자리) "11"과, 구 단위 3자리 "111"(남구)·"113"(북구)를 같은 달로 비교
  if (!authFailed) {
    for (const [label, gugun] of [
      ["pohang-11", "11"],
      ["pohang-111", "111"],
      ["pohang-113", "113"],
    ] as const) {
      reports.push(await call(apiKey, label, gumiMonth, "47", gugun));
    }
  }

  const output = {
    검증일시: new Date().toISOString(),
    안내: "이 요약에는 인증키·상호명·주소·성명 원문이 없습니다. 이 내용을 그대로 복사해 전달하십시오.",
    호출결과: reports.map(({ savedRaw: _saved, ...rest }) => rest),
  };
  console.log("===== KESCO OpenAPI 검증 요약 (복사해서 전달) =====");
  console.log(JSON.stringify(output, null, 2));
  console.log("===== 끝 =====");
  console.log(`원본 응답 저장 위치: ${path.relative(process.cwd(), OUT_DIR)} (개인정보가 있을 수 있으니 공유하지 마십시오)`);
}

/**
 * 전국 확대 때 실제 응답으로 확인하지 못한 코드 대응을 한 번씩 확인한다 (약 17회 호출).
 * 각 쌍은 '이 프로그램이 쓰는 코드'와 '다른 후보 코드'를 같은 달로 비교한다.
 */
async function verifyRegions(apiKey: string, month: string): Promise<void> {
  const cases: Array<[string, string, string, string[]?]> = [
    ["강원 춘천(42-11)", "42", "11"],
    ["강원 춘천(51-11)", "51", "11"],
    ["전북 전주(45-11)", "45", "11", ["완산구", "덕진구"]],
    ["전북 전주(52-11)", "52", "11", ["완산구", "덕진구"]],
    ["광주 동구(29-11)", "29", "11"],
    ["광주 동구(12-21)", "12", "21"],
    ["전남 고흥(46-77)", "46", "77"],
    ["전남 고흥(12-74)", "12", "74"],
    ["인천 제물포구(28-12)", "28", "12"],
    ["인천 옛 중구(28-11)", "28", "11"],
    ["인천 서해구(28-27)", "28", "27"],
    ["인천 옛 서구(28-26)", "28", "26"],
    ["수원시(41-11)", "41", "11", ["장안구", "권선구", "팔달구", "영통구"]],
    ["화성시(41-59)", "41", "59", ["만세구", "효행구", "병점구", "동탄구"]],
    ["창원시(48-12)", "48", "12", ["의창구", "성산구", "마산합포구", "마산회원구", "진해구"]],
    ["청주시(43-11)", "43", "11", ["상당구", "서원구", "흥덕구", "청원구"]],
    ["서울 광진구(11-21)", "11", "21"],
  ];
  const reports = [];
  for (const [label, sido, gugun, districts] of cases) {
    const r = await call(apiKey, `region-${sido}${gugun}`, month, sido, gugun, districts ?? []);
    reports.push({
      label,
      query: r.query,
      httpStatus: r.httpStatus,
      parse: r.parse,
      records: r.summary?.records ?? 0,
      SIDO_SIGUNGU값: r.summary?.regionCodes ?? null,
      주소_구별건수: r.districtCounts ?? null,
    });
    if (r.parse.error?.startsWith("auth")) break;
  }
  console.log("===== KESCO OpenAPI 지역코드 검증 요약 (복사해서 전달) =====");
  console.log(JSON.stringify({ 검증일시: new Date().toISOString(), 조회연월: month, 안내: "인증키·상호명·주소 원문 없음", 결과: reports }, null, 2));
  console.log("===== 끝 =====");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
