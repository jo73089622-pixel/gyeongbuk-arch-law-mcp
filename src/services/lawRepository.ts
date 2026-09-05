import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, PARSED_LAW_SUBDIR } from "../config.js";
import { readJSON } from "../storage.js";
import type { LawArticle, ParsedLaw } from "../parseLawApi.js";

async function listLawFiles(): Promise<string[]> {
  const dir = path.join(DATA_DIR, PARSED_LAW_SUBDIR);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export interface LawSummary {
  lawId: string;
  lawName?: string;
  lawType?: string;
  ministry?: string;
  effectiveDate?: string;
  articleCount: number;
}

export async function listLaws(): Promise<LawSummary[]> {
  const files = await listLawFiles();
  return Promise.all(
    files.map(async (file) => {
      const fallbackId = path.basename(file, ".json");
      const law = await readJSON<ParsedLaw>(`${PARSED_LAW_SUBDIR}/${file}`, { articles: [] });
      return {
        lawId: law.lawId ?? fallbackId,
        lawName: law.lawName,
        lawType: law.lawType,
        ministry: law.ministry,
        effectiveDate: law.effectiveDate,
        articleCount: law.articles.length,
      };
    })
  );
}

export async function getLaw(lawId: string): Promise<ParsedLaw | null> {
  return readJSON<ParsedLaw | null>(`${PARSED_LAW_SUBDIR}/${lawId}.json`, null);
}

export async function getArticle(lawId: string, articleNumber: string): Promise<LawArticle | undefined> {
  const law = await getLaw(lawId);
  return law?.articles.find((a) => a.number === articleNumber);
}

export interface ArticleSearchHit {
  lawId: string;
  lawName?: string;
  article: LawArticle;
}

function articleText(article: LawArticle): string {
  const paragraphText = article.paragraphs
    .map((p) => [p.content, ...p.subItems.map((s) => [s.content, ...s.items.map((i) => i.content)].join(" "))].join(" "))
    .join(" ");
  return [article.title, article.content, paragraphText].filter(Boolean).join(" ");
}

/** 저장된 법령들의 조문 텍스트에서 query를 단순 포함 검색한다 (대소문자 구분 없음). */
export async function searchArticles(query: string, lawId?: string): Promise<ArticleSearchHit[]> {
  const files = lawId ? [`${lawId}.json`] : await listLawFiles();
  const needle = query.toLowerCase();
  const hits: ArticleSearchHit[] = [];

  for (const file of files) {
    const fallbackId = path.basename(file, ".json");
    const law = await readJSON<ParsedLaw>(`${PARSED_LAW_SUBDIR}/${file}`, { articles: [] });
    for (const article of law.articles) {
      if (articleText(article).toLowerCase().includes(needle)) {
        hits.push({ lawId: law.lawId ?? fallbackId, lawName: law.lawName, article });
      }
    }
  }

  return hits;
}
