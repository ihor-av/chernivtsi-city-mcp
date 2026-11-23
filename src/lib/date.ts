const MONTHS: Record<string, number> = {
  січ: 1,
  січня: 1,
  січень: 1,
  лют: 2,
  лютого: 2,
  лютий: 2,
  бер: 3,
  березня: 3,
  березень: 3,
  кві: 4,
  квітня: 4,
  квітень: 4,
  тра: 5,
  травня: 5,
  травень: 5,
  чер: 6,
  червня: 6,
  червень: 6,
  лип: 7,
  липня: 7,
  липень: 7,
  сер: 8,
  серпня: 8,
  серпень: 8,
  вер: 9,
  вересня: 9,
  вересень: 9,
  жов: 10,
  жовтня: 10,
  жовтень: 10,
  лис: 11,
  листопада: 11,
  листопад: 11,
  гру: 12,
  грудня: 12,
  грудень: 12,
};

const MONTH_ABBREVIATIONS: Record<string, number> = {
  січ: 1,
  лют: 2,
  бер: 3,
  кві: 4,
  тра: 5,
  чер: 6,
  лип: 7,
  сер: 8,
  вер: 9,
  жов: 10,
  лис: 11,
  гру: 12,
};

function iso(year: number, month: number, day: number, hour = 12, minute = 0): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mi = String(minute).padStart(2, "0");
  return `${year}-${mm}-${dd}T${hh}:${mi}:00+02:00`;
}

export function parseCityListDate(value: string, now = new Date()): string | undefined {
  const text = value.replace(/\s+/g, " ").trim();
  const short = /(\d{1,2})\s+([А-Яа-яІіЇїЄєҐґ]+),?\s+(\d{1,2}):(\d{2})/.exec(text);
  if (short) {
    const day = Number(short[1]);
    const month = MONTH_ABBREVIATIONS[short[2]!.toLowerCase().slice(0, 3)];
    if (month) {
      let year = now.getUTCFullYear();
      const candidate = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00Z`);
      if (candidate.getTime() > now.getTime() + 7 * 86400_000) year -= 1;
      return iso(year, month, day, Number(short[3]), Number(short[4]));
    }
  }
  return undefined;
}

export function parseUkrainianDate(
  value: string,
  now = new Date(),
  preferFuture = false,
): string | undefined {
  const text = value.replace(/\s+/g, " ").trim();
  const timeMatch = /(?:о|об)\s+(\d{1,2})[:.](\d{2})/i.exec(text);
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  const full = /(\d{1,2})\s+([А-Яа-яІіЇїЄєҐґ]+)(?:\s+(\d{4}))?/i.exec(text);
  if (full) {
    const day = Number(full[1]);
    const monthName = full[2]!.toLowerCase();
    const month = MONTHS[monthName] ?? MONTHS[monthName.slice(0, 3)];
    if (month) {
      let year = full[3] ? Number(full[3]) : now.getUTCFullYear();
      if (!full[3]) {
        const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
        if (candidate.getTime() < now.getTime() - 30 * 86400_000) year += 1;
        if (preferFuture && candidate.getTime() < now.getTime() - 86400_000) year += 1;
      }
      return iso(year, month, day, hour, minute);
    }
  }

  const numeric = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    return iso(year, Number(numeric[2]), day, hour, minute);
  }

  return undefined;
}

export function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysIso(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 86400_000).toISOString();
}

export function isWithin(dateIso: string | undefined, from?: string, to?: string): boolean {
  const date = parseIsoDate(dateIso);
  if (!date) return false;
  if (from && date.getTime() < new Date(from).getTime()) return false;
  if (to && date.getTime() > new Date(to).getTime()) return false;
  return true;
}

export function kyivNow(): Date {
  return new Date();
}

export function monthNameUa(month: number): string {
  return [
    "січня",
    "лютого",
    "березня",
    "квітня",
    "травня",
    "червня",
    "липня",
    "серпня",
    "вересня",
    "жовтня",
    "листопада",
    "грудня",
  ][month - 1] ?? String(month);
}
