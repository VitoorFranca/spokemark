// Match a stored target language to the ids the translator reports (minimal BCP-47
// tags such as "pt", "es", "es-MX"): exact match first, then the same base language.
export function matchLanguage(target: string, ids: string[]): string | null {
  if (ids.includes(target)) return target;
  const base = target.split('-')[0]!.toLowerCase();
  return ids.find((id) => id.toLowerCase() === base) ?? ids.find((id) => id.split('-')[0]!.toLowerCase() === base) ?? null;
}
