import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 저장소 최상위 폴더 (dist/ 또는 src/ 의 한 단계 위) */
export const PROJECT_ROOT = path.resolve(__dirname, "..");

export const DATA_DIR = path.join(PROJECT_ROOT, "data");
