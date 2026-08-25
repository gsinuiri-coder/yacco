/**
 * Minimal RFC4180-style CSV tokenizer: quoted fields, embedded commas and
 * newlines inside quotes, `""` as an escaped quote. No dependency added —
 * the source files are small (a few hundred rows), hand-rolled here the
 * same way the rest of this codebase avoids a library for a narrow, fully
 * specified format (e.g. tools/firestore-export's own type converter).
 */
export interface CsvRow {
  /** 1-based line in the file where this row starts (header is line 1). */
  line: number;
  cells: string[];
}

export interface ParsedCsv {
  header: string[];
  rows: CsvRow[];
}

/** Splits raw CSV text into a header row and data rows, tracking line numbers. */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  const rowStartLines: number[] = [];
  let field = "";
  let row: string[] = [];
  let line = 1;
  let rowStartLine = 1;
  let inQuotes = false;
  let sawAnyFieldOnLine = false;

  function endField(): void {
    row.push(field);
    field = "";
  }
  function endRow(): void {
    endField();
    // Skip a fully blank trailing line (no fields at all seen since the last row).
    if (!(row.length === 1 && row[0] === "" && !sawAnyFieldOnLine)) {
      rows.push(row);
      rowStartLines.push(rowStartLine);
    }
    row = [];
    sawAnyFieldOnLine = false;
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      sawAnyFieldOnLine = true;
      continue;
    }
    if (char === ",") {
      endField();
      sawAnyFieldOnLine = true;
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      endRow();
      line += 1;
      rowStartLine = line;
      continue;
    }
    field += char;
    sawAnyFieldOnLine = true;
  }
  // Final row: only emit it if the file didn't already end with a newline.
  if (field !== "" || row.length > 0 || sawAnyFieldOnLine) {
    endRow();
  }

  const [header, ...dataRows] = rows;
  const dataStartLines = rowStartLines.slice(1);
  return {
    header: header ?? [],
    rows: dataRows.map((cells, index) => ({
      cells,
      line: dataStartLines[index] ?? 0,
    })),
  };
}
