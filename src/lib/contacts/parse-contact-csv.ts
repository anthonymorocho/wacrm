/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Included only when parsing campaign CSVs with includeColumnValues. */
  columnValues?: Record<string, string>;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

export interface ParseContactCsvOptions {
  /** Preserve all columns for mapping campaign template variables. */
  includeColumnValues?: boolean;
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** Original CSV headers, when includeColumnValues is enabled. */
  columnNames?: string[];
  /** True when the CSV header includes a `phone` column. */
  hasPhoneColumn: boolean;
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

export function parseContactCsv(
  text: string,
  options: ParseContactCsvOptions = {},
): ParseContactCsvResult {
  const content = text.replace(/^\uFEFF/, '').trim();
  if (!content) {
    return {
      rows: [],
      ...(options.includeColumnValues ? { columnNames: [] } : {}),
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }
  const lines = content.split(/\r?\n/);

  const headerCells = parseCsvLine(lines[0]).map((header) =>
    header.trim().replace(/^['"]|['"]$/g, ''),
  );
  const headers = headerCells.map((header) => header.toLowerCase());
  const seenColumnNames = new Set<string>();
  const columnNames: string[] = [];
  for (const header of headerCells) {
    const normalizedHeader = header.toLowerCase();
    if (header && !seenColumnNames.has(normalizedHeader)) {
      seenColumnNames.add(normalizedHeader);
      columnNames.push(header);
    }
  }

  const phoneIdx = headers.indexOf('phone');
  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx = headers.indexOf('tags');

  if (phoneIdx === -1 || lines.length < 2) {
    return {
      rows: [],
      ...(options.includeColumnValues ? { columnNames } : {}),
      hasPhoneColumn: phoneIdx >= 0,
      hasTagsColumn: tagsIdx >= 0,
      hasCompanyColumn: companyIdx >= 0,
    };
  }

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    const row: ParsedContactRow = {
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    };

    if (options.includeColumnValues) {
      const columnValueEntries: [string, string][] = [];
      const seenColumns = new Set<string>();
      for (let columnIdx = 0; columnIdx < headerCells.length; columnIdx++) {
        const columnName = headerCells[columnIdx];
        const normalizedColumn = columnName.toLowerCase();
        if (columnName && !seenColumns.has(normalizedColumn)) {
          seenColumns.add(normalizedColumn);
          columnValueEntries.push([
            columnName,
            values[columnIdx]?.trim() ?? '',
          ]);
        }
      }
      row.columnValues = Object.fromEntries(columnValueEntries);
    }

    rows.push(row);
  }

  return {
    rows,
    ...(options.includeColumnValues ? { columnNames } : {}),
    hasPhoneColumn: true,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
