/**
 * 국토교통부 법정동코드 CSV(공공데이터포털 15123287)로 전국 시도·시군구 목록(src/elec/regionData.ts)을 만든다.
 *
 * 사용법: node dist/scripts/buildRegionData.js <법정동코드 CSV 경로> <자료명(예: 국토교통부_법정동코드_20260929)>
 *
 * - '존재'인 코드만 쓴다.
 * - 시 아래의 구(예: 수원시 장안구)는 parent(시 코드)를 단다. 조회는 시 코드로 하고 구는 주소로 거른다.
 * - 전남광주통합특별시(12)는 전기안전종합정보시스템이 아직 광주(29)·전남(46) 코드를 쓰므로,
 *   이름이 같은 폐지 코드(29·46)를 legacy로 단다(대응이 없으면 비워 둔다).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../config.js";

interface Row {
  code: string;
  name: string;
  alive: boolean;
}

function parse(text: string): Row[] {
  const lines = text.split(/\r?\n/).slice(1).filter(Boolean);
  return lines.map((line) => {
    const [code, name, status] = line.split(",");
    return { code: code.trim(), name: name.trim(), alive: status.trim() === "존재" };
  });
}

const isSigungu = (code: string) => code.slice(5) === "00000" && code.slice(2, 5) !== "000";
const isSido = (code: string) => code.slice(2) === "00000000";
const local = (name: string) => name.split(" ").slice(1).join(" ");

async function main(): Promise<void> {
  const [csvPath, sourceName] = process.argv.slice(2);
  if (!csvPath || !sourceName) {
    console.error("사용법: node dist/scripts/buildRegionData.js <CSV 경로> <자료명>");
    process.exitCode = 1;
    return;
  }
  const buf = await fs.readFile(csvPath);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    text = new TextDecoder("euc-kr").decode(buf);
  }
  const rows = parse(text);

  const sidoNames = new Map<string, string>();
  for (const r of rows) if (r.alive && isSido(r.code)) sidoNames.set(r.code.slice(0, 2), r.name);

  const alive = rows.filter((r) => r.alive && isSigungu(r.code));
  const aliveByCode = new Map(alive.map((r) => [r.code.slice(0, 5), r]));
  const abolished = rows.filter((r) => !r.alive && isSigungu(r.code));

  const out: Array<{ code: string; sido: string; name: string; parent?: string; legacy?: string }> = [];
  for (const r of alive) {
    const code = r.code.slice(0, 5);
    const sido = code.slice(0, 2);
    if (!sidoNames.has(sido)) sidoNames.set(sido, r.name.split(" ")[0]); // 세종처럼 시도 행이 없는 경우
    const name = local(r.name) || r.name;
    const parentCode = code.slice(0, 4) + "0";
    const parent = aliveByCode.get(parentCode);
    const isChild = code[4] !== "0" && parent !== undefined && local(parent.name).endsWith("시") && name.endsWith("구");
    const entry: { code: string; sido: string; name: string; parent?: string; legacy?: string } = { code, sido, name };
    if (isChild) entry.parent = parentCode;
    if (sido === "12") {
      const wantSido = name.endsWith("구") ? "29" : "46";
      const match = abolished.find((a) => a.code.startsWith(wantSido) && local(a.name) === name);
      if (match) entry.legacy = match.code.slice(0, 5);
    }
    out.push(entry);
  }

  const sidoList = [...sidoNames.entries()].sort().map(([code, name]) => ({ code, name }));
  const file = [
    "// 자동 생성 파일 — 직접 고치지 말고 src/scripts/buildRegionData.ts 로 다시 만드십시오.",
    `// 출처: ${sourceName} (공공데이터포털 15123287, 국토교통부). '존재' 코드만 수록.`,
    "",
    `export const REGION_SOURCE = ${JSON.stringify(sourceName)};`,
    "",
    "export interface SidoRow {\n  code: string;\n  name: string;\n}",
    "",
    "export interface SigunguRow {\n  /** 현행 법정동 시군구코드 5자리 */\n  code: string;\n  /** 현행 시도코드 2자리 */\n  sido: string;\n  /** 시도를 뺀 이름 (예: 수원시 장안구) */\n  name: string;\n  /** 시 아래 구이면 그 시의 코드 */\n  parent?: string;\n  /** 전기안전종합정보시스템이 쓰는 옛 코드 (전남광주통합특별시) */\n  legacy?: string;\n}",
    "",
    `export const SIDO_ROWS: readonly SidoRow[] = ${JSON.stringify(sidoList, null, 2)};`,
    "",
    `export const SIGUNGU_ROWS: readonly SigunguRow[] = ${JSON.stringify(out, null, 2)};`,
    "",
  ].join("\n");
  const target = path.join(PROJECT_ROOT, "src", "elec", "regionData.ts");
  await fs.writeFile(target, file, "utf-8");
  const noLegacy = out.filter((e) => e.sido === "12" && !e.legacy).map((e) => e.name);
  console.log(`시도 ${sidoList.length}개, 시군구 ${out.length}개 → ${path.relative(PROJECT_ROOT, target)}`);
  if (noLegacy.length) console.log(`옛 코드 대응을 찾지 못한 전남광주 지역: ${noLegacy.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
