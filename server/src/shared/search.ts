/**
 * Search that forgives Roman Urdu spelling: "tonti", "tooti", "toti" and "Tonti" all match.
 * The same folding runs on the text and the query, so it only has to be consistent, not correct.
 */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/([kgpbtdcsj])h/g, '$1')
    .replace(/ph/g, 'f')
    .replace(/q/g, 'k')
    .replace(/c/g, 'k')
    .replace(/w/g, 'v')
    .replace(/[ey]/g, 'i')
    .replace(/o/g, 'u')
    .replace(/(\p{L})\1+/gu, '$1');
}

export interface Searchable {
  code: string;
  barcode: string | null;
  nameEn: string;
  nameUr: string;
  aliases: string;
  brand: string;
  size: string;
}

export function searchText(p: Searchable): string {
  return normalizeSearch([p.code, p.barcode ?? '', p.nameEn, p.nameUr, p.aliases, p.brand, p.size].join(' '));
}

/**
 * Score of a product for a query: 0 = no match. Exact code/barcode wins,
 * then names starting with the query, then any match where every word is found.
 */
export function matchScore(p: Searchable, query: string, haystack = searchText(p)): number {
  const q = query.trim();
  if (!q) return 0;
  const lower = q.toLowerCase();
  if (p.barcode && p.barcode.toLowerCase() === lower) return 100;
  if (p.code.toLowerCase() === lower) return 90;
  const words = q.split(/\s+/).map(normalizeSearch).filter(Boolean);
  if (words.length === 0 || !words.every((w) => haystack.includes(w))) return 0;
  return normalizeSearch(p.nameEn).startsWith(words[0]) ? 50 : 10;
}

/** Best matches first. `limit` keeps the result list short for the POS grid. */
export function searchProducts<T extends Searchable>(items: T[], query: string, limit = 60, haystacks?: Map<T, string>): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = matchScore(item, query, haystacks?.get(item));
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.nameEn.localeCompare(b.item.nameEn));
  return scored.slice(0, limit).map((s) => s.item);
}
