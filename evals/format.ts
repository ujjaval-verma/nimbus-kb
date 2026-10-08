// Model answers are embedded under the run's own "## Q1: ..." headings in latest.md; demote theirs by two levels
// so an answer's "## Nimbus Relay" does not read as a peer of the case heading.
export function demoteHeadings(markdown: string): string {
  let fenced = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return line;
    const m = /^(#{1,6}) /.exec(line);
    return m ? "#".repeat(Math.min(6, m[1].length + 2)) + line.slice(m[1].length) : line;
  }).join("\n");
}
