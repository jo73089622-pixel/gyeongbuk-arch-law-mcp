import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, "..", "data");

/** 국가법령정보센터 오픈API 원본 응답 JSON을 저장하는 하위 폴더명 (data/ 기준 상대경로) */
export const RAW_LAW_SUBDIR = "raw";

/** 파싱된 법령 JSON을 저장하는 하위 폴더명 (data/ 기준 상대경로) */
export const PARSED_LAW_SUBDIR = "laws";
