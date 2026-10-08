import { CORPUS } from "./corpus.gen";
import { parseSections, type Section } from "./sections";

export const SECTIONS: Section[] = parseSections(CORPUS);
export const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));
const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));
export function getSection(id: string): Section | undefined { return BY_ID.get(id); }
export type { Section, Product, DocType } from "./sections";
