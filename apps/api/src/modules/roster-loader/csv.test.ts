import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("splits a header and its data rows, tracking 1-based line numbers (header is line 1)", () => {
    const result = parseCsv("a,b,c\n1,2,3\n4,5,6\n");

    expect(result.header).toEqual(["a", "b", "c"]);
    expect(result.rows).toEqual([
      { line: 2, cells: ["1", "2", "3"] },
      { line: 3, cells: ["4", "5", "6"] },
    ]);
  });

  it("parses a quoted field containing a comma", () => {
    const result = parseCsv('a,b\n"1,2",3\n');

    expect(result.rows).toEqual([{ line: 2, cells: ["1,2", "3"] }]);
  });

  it('unescapes a doubled quote ("") inside a quoted field', () => {
    const result = parseCsv('a\n"He said ""hi""."\n');

    expect(result.rows).toEqual([{ line: 2, cells: ['He said "hi".'] }]);
  });

  it("handles a file with no trailing newline", () => {
    const result = parseCsv("a,b\n1,2");

    expect(result.rows).toEqual([{ line: 2, cells: ["1", "2"] }]);
  });

  it("does not emit a bogus row for a trailing blank line", () => {
    const result = parseCsv("a,b\n1,2\n\n");

    expect(result.rows).toEqual([{ line: 2, cells: ["1", "2"] }]);
  });

  it("preserves empty fields", () => {
    const result = parseCsv("a,b,c\n1,,3\n");

    expect(result.rows).toEqual([{ line: 2, cells: ["1", "", "3"] }]);
  });

  it("strips \\r from CRLF line endings", () => {
    const result = parseCsv("a,b\r\n1,2\r\n");

    expect(result.header).toEqual(["a", "b"]);
    expect(result.rows).toEqual([{ line: 2, cells: ["1", "2"] }]);
  });

  it("returns an empty header and no rows for empty text", () => {
    const result = parseCsv("");

    expect(result.header).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("counts lines correctly across a multi-line quoted field", () => {
    const result = parseCsv('a,b\n"multi\nline",2\n3,4\n');

    expect(result.rows).toEqual([
      { line: 2, cells: ["multi\nline", "2"] },
      { line: 4, cells: ["3", "4"] },
    ]);
  });
});
