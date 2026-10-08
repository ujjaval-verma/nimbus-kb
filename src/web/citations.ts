const GROUP = /\[([^[\]]+)\](?!\()/g;
const REF = /^[a-z0-9-]+\.md#[a-z0-9-]+$/;
export const label = (id: string) => { const [file, anchor] = id.split("#"); return `${file.replace(/\.md$/, "")} › ${anchor}`; };

export function linkCitations(md: string): string {
  return md.replace(GROUP, (whole, inner: string) => {
    const parts = inner.split(",").map((p) => p.trim());
    if (!parts.every((p) => REF.test(p))) return whole;
    return parts.map((id) => `[${label(id)}](#src-${id})`).join(" ");
  });
}
