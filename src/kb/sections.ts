export type Product = "relay" | "vault" | "pulse" | "ledger" | "company";
export type DocType = "product" | "release-notes" | "company";

export interface Section {
  id: string; file: string; product: Product; docType: DocType; docTitle: string;
  heading: string; headingPath: string; docDate: string | null; version: string | null; text: string;
}

const PRODUCTS = ["relay", "vault", "pulse", "ledger"] as const;
const DATE = /(\d{4}-\d{2}-\d{2})/;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function productOf(file: string): Product {
  return PRODUCTS.find((p) => file.startsWith(`${p}.`) || file.startsWith(`${p}-`)) ?? "company";
}

export function parseSections(files: ReadonlyArray<{ file: string; content: string }>): Section[] {
  const out: Section[] = [];
  for (const { file, content } of files) {
    const product = productOf(file);
    const docType: DocType = file.includes("release-notes") ? "release-notes" : product === "company" ? "company" : "product";
    const lines = content.split("\n");
    const docTitle = (lines.find((l) => l.startsWith("# ")) ?? `# ${file}`).slice(2).trim();
    const updated = content.match(/updated (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

    const blocks: { heading: string | null; body: string[] }[] = [{ heading: null, body: [] }];
    for (const line of lines) {
      if (line.startsWith("## ")) blocks.push({ heading: line.slice(3).trim(), body: [] });
      else if (line.startsWith("# ")) continue;
      else blocks[blocks.length - 1].body.push(line);
    }

    for (const { heading, body } of blocks) {
      let text = body.join("\n").trim();
      if (heading === null) {
        text = text.replace(/^\*[^*\n]*updated \d{4}-\d{2}-\d{2}\*\s*/m, "").trim();
        if (!text) continue;
        out.push({ id: `${file}#overview`, file, product, docType, docTitle, heading: "Overview",
          headingPath: docTitle, docDate: updated, version: null, text });
        continue;
      }
      const version = docType === "release-notes" ? (heading.match(/^(\d+(?:\.\d+)+)/)?.[1] ?? null) : null;
      const docDate = docType === "release-notes" ? (heading.match(DATE)?.[1] ?? null) : updated;
      out.push({
        id: `${file}#${version ? slug(version) : slug(heading)}`,
        file, product, docType, docTitle, heading,
        headingPath: `${docTitle} > ${heading}`, docDate, version, text,
      });
    }
  }
  return out;
}
