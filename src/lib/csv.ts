export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [";", ",", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!;
    const next = clean[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (char === "\r") {
      // ignore
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim().length > 0));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty, delimiter: sep };
}

export function toObjects(table: CsvTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const object: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });
    return object;
  });
}

export function isCsvFormat(format: string | undefined): boolean {
  if (!format) return false;
  return /csv|tsv|text\/plain/i.test(format);
}

export function isJsonFormat(format: string | undefined): boolean {
  if (!format) return false;
  return /json|geojson/i.test(format);
}
