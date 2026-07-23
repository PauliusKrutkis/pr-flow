/** The first line of a comment body — the snippet both surfaces show folded. */
export function firstLine(body: string): string {
  return body.trim().split("\n")[0] ?? "";
}
