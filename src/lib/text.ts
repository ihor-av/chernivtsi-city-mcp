export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’'`ʼ]/g, "")
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STREET_WORDS = new Set([
  "вулиця",
  "вул",
  "проспект",
  "просп",
  "бульвар",
  "б",
  "р",
  "провулок",
  "пров",
  "площа",
  "пл",
  "набережна",
  "наб",
  "шосе",
  "дорога",
  "проїзд",
  "тупик",
  "туп",
  "завулок",
  "завул",
]);

export function normalizeStreet(value: string): string {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word && !STREET_WORDS.has(word))
    .join(" ");
}

const STREET_PREFIX =
  /(?:вул\.?|вулиця|просп\.?|проспект|б-р|бульвар|пров\.?|провулок|пл\.?|площа|наб\.?|набережна|шосе|дорога|проїзд|туп\.?|тупик)\s*/giu;

export function extractStreetHouse(value: string): { street: string; house?: string } {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const match =
    /^(?:(?:м\.?\s*)?Чернівці,?\s*)?(?:(?:вул\.?|вулиця|просп\.?|проспект|б-р|бульвар|пров\.?|провулок|пл\.?|площа|наб\.?|набережна)\s*)?(.+?)[,\s]+(\d+[А-Яа-яA-Za-z0-9/-]*)\s*$/iu.exec(
      cleaned,
    );
  if (match) {
    return { street: normalizeStreet(match[1]!), house: match[2]!.toUpperCase() };
  }
  return { street: normalizeStreet(cleaned.replace(STREET_PREFIX, "")) };
}

export function tokens(value: string, minLength = 3): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= minLength);
}

export function containsAny(haystack: string, needles: string[]): boolean {
  const normalized = normalizeText(haystack);
  return needles.some((needle) => normalized.includes(normalizeText(needle)));
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
