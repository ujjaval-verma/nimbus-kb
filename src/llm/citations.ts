const GROUP = /\[([^[\]]+)\](?!\()/g;      // [ ... ] not followed by "(" (skips markdown links)
const REF = /^[a-z0-9-]+\.md#[a-z0-9-]+$/;

export function extractCitations(text: string, validIds: Set<string>): { citedIds: string[]; invalidRefCount: number } {
  const cited: string[] = [];
  let invalid = 0;
  for (const m of text.matchAll(GROUP)) {
    const parts = m[1].split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0 || !parts.every((p) => REF.test(p))) continue;   // plain bracketed words like [Pro]
    for (const p of parts) {
      if (!validIds.has(p)) invalid++;
      else if (!cited.includes(p)) cited.push(p);
    }
  }
  return { citedIds: cited, invalidRefCount: invalid };
}
