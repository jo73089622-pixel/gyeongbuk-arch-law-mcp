/**
 * 검색 결과를 사람이 읽는 마크다운으로 바꾼다 (MCP 도구 응답용).
 */

import type { SearchResult } from "./service.js";
import type { CapacityRecord } from "./types.js";

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function num(value: number | null, raw: string | null): string {
  if (value === 0) return "0(원문 값)";
  if (value !== null) return value.toLocaleString("ko-KR");
  return raw ? `${raw}(원문)` : "-";
}

function address(r: CapacityRecord): string {
  return [r.roadAddress, r.lotAddress && r.lotAddress !== r.roadAddress ? `(지번 ${r.lotAddress})` : null]
    .filter(Boolean)
    .join(" ");
}

export function formatSearchMarkdown(result: SearchResult): string {
  const { counts, period, region, query } = result;
  const lines: string[] = [];
  lines.push(`# 수전설비 용량 조회 결과 — ${region.name}`);
  lines.push("");
  lines.push(
    `- 조회기간: ${period.from} ~ ${period.to} (${period.months}개월) · 구분: ${query.category} · 검색어: ${query.keyword ?? "(없음)"}`
  );
  lines.push(
    `- 받은 기록 ${counts.fetchedRecords.toLocaleString("ko-KR")}건 → 조건에 맞는 기록 ${counts.matchedRecords.toLocaleString("ko-KR")}건` +
      (query.latestOnly ? ` → 시설별 최신 ${counts.distinctRecords.toLocaleString("ko-KR")}건` : "") +
      ` · 표시 ${counts.returnedRecords}건${counts.truncated ? " (나머지는 검색어로 좁혀 다시 조회)" : ""}`
  );
  lines.push(`- 저장본 사용 ${counts.monthsFromCache}개월 · 새로 받음 ${counts.monthsFromApi}개월`);
  if (result.failedMonths.length > 0) {
    lines.push(`- ⚠️ 받지 못한 달: ${result.failedMonths.map((f) => f.month).join(", ")} (결과가 불완전함)`);
  }
  if (result.monthMessages.length > 0) {
    lines.push(`- 안내 문구가 온 달: ${result.monthMessages.map((m) => `${m.month} "${m.message}"`).join(", ")}`);
  }
  lines.push("");

  if (result.records.length === 0) {
    lines.push("**데이터 없음** — 조건에 맞는 검사 기록이 없습니다. 지역·기간·검색어를 확인하십시오.");
  } else {
    lines.push("| 상호 | 소재지 | 수전전압(V) | 수전용량(kW) | 발전용량(kW) | 구분 | 검사종류 | 검사일 | 결과 | 안전등급 |");
    lines.push("|---|---|---:|---:|---:|---|---|---|---|---|");
    for (const r of result.records) {
      lines.push(
        `| ${cell(r.businessName)} | ${cell(address(r))} | ${num(r.receivingVoltageV, r.raw.receivingVoltage)} | ` +
          `${num(r.receivingCapacityKw, r.raw.receivingCapacity)} | ${num(r.generationCapacityKw, r.raw.generationCapacity)} | ` +
          `${cell(r.category)} | ${cell([r.inspectionType, r.inspectionKind].filter(Boolean).join(" · "))} | ` +
          `${cell(r.inspectionEnd ?? r.inspectionStart)} | ${cell(r.result)} | ${cell(r.safetyGrade)} |`
      );
    }
  }

  lines.push("");
  lines.push("## 유의사항");
  for (const note of result.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}
