/**
 * 수전설비 조회 자료를 미리 받아 저장해 두는 명령 (예: 퇴근 후·야간 실행).
 *
 * 사용법:
 *   node dist/scripts/kescoPrefetch.js --sigungu 구미시 [--sigungu 47130 ...] [--months 38] [--refresh]
 *   node dist/scripts/kescoPrefetch.js --all-gyeongbuk [--months 38]
 *
 * 시군 하나에 한 달당 1회씩 전기안전종합정보시스템 OpenAPI를 호출한다(이미 저장된 달은 건너뜀).
 * 경상북도 전체(22개 시군 × 38개월)는 최대 836회 호출하므로 시간이 오래 걸린다.
 */

import "../env.js";
import { KesApiError } from "../elec/kescoClient.js";
import { GYEONGBUK_SIGUNGU } from "../elec/regions.js";
import { defaultMonths, searchReceivingCapacity, SearchInputError } from "../elec/service.js";

interface Args {
  sigungu: string[];
  all: boolean;
  months?: number;
  refresh: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { sigungu: [], all: false, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--sigungu") args.sigungu.push(argv[++i] ?? "");
    else if (a === "--all-gyeongbuk") args.all = true;
    else if (a === "--months") args.months = Number(argv[++i]);
    else if (a === "--refresh") args.refresh = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.all ? GYEONGBUK_SIGUNGU.map((s) => s.code) : args.sigungu.filter(Boolean);
  if (targets.length === 0) {
    console.error(
      "사용법: node dist/scripts/kescoPrefetch.js --sigungu <시군 이름 또는 5자리 코드> [--months N] [--refresh]\n" +
        "        node dist/scripts/kescoPrefetch.js --all-gyeongbuk [--months N]"
    );
    process.exitCode = 1;
    return;
  }

  const months = args.months ?? defaultMonths();
  for (const target of targets) {
    try {
      const result = await searchReceivingCapacity(
        { sigungu: target, months, category: "전체", latestOnly: false, refresh: args.refresh, limit: 1 },
        {
          onProgress: (p) => {
            if (p.source !== "cache") process.stdout.write(`  ${target} ${p.done}/${p.total} ${p.month} ${p.source}\n`);
          },
        }
      );
      console.log(
        `${result.region.name}: ${result.period.from}~${result.period.to} 저장본 ${result.counts.monthsFromCache}개월, ` +
          `새로 받음 ${result.counts.monthsFromApi}개월, 기록 ${result.counts.fetchedRecords}건` +
          (result.failedMonths.length ? `, 실패 ${result.failedMonths.length}개월(다시 실행하면 이어서 받음)` : "")
      );
    } catch (err) {
      if (err instanceof KesApiError && err.kind === "auth") {
        console.error(err.message);
        process.exitCode = 1;
        return;
      }
      const message = err instanceof SearchInputError || err instanceof KesApiError ? err.message : (err as Error).message;
      console.error(`${target}: ${message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
