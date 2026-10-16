export const FLOW_LIMIT = 50;
export const normalizeLogin = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export const displayName = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/gu, " ");
export function parseStudentList(text: string) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const name = displayName(
      line.replace(/^\s*(?:№\s*)?\d+\s*(?:[.):;\-–]\s*|\s+)/u, ""),
    );
    const valid =
      name.length <= 120 &&
      /^[\p{L}\p{M}][\p{L}\p{M}.'’\-]*(?: [\p{L}\p{M}][\p{L}\p{M}.'’\-]*){1,5}$/u.test(
        name,
      );
    return [
      {
        line: index + 1,
        name,
        login: name,
        error: valid ? "" : "Укажите фамилию и имя, при наличии — отчество.",
      },
    ];
  });
}
