export type ExportTable = {
  name: string;
  headers: string[];
  rows: (string | number)[][];
};
const xml = (v: unknown) =>
  String(v ?? "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
function column(n: number): string {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function collectReportTables(root: HTMLElement): ExportTable[] {
  const clean = (node: HTMLElement) => {
    const copy = node.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll("svg,.mobile-cell-label,.mobile-row-toggle")
      .forEach((n) => n.remove());
    copy.querySelectorAll("small").forEach((n) => n.prepend(" "));
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  };
  return Array.from(root.querySelectorAll<HTMLTableElement>("table"))
    .filter((t) => !t.closest(".overlay"))
    .map((t, i) => {
      const header = Array.from(
        t.tHead?.rows[t.tHead.rows.length - 1]?.cells || [],
      );
      const headers = header.map(
        (c) =>
          c
            .querySelector(".table-sort-button")
            ?.getAttribute("aria-label")
            ?.replace(/^Ordenar por /, "")
            .replace(/: (ascendente|descendente)$/, "") || clean(c),
      );
      const indexes = headers
        .map((h, i) => (/^(Acciones|Foto)$/i.test(h) ? -1 : i))
        .filter((i) => i >= 0);
      const rows = Array.from(t.tBodies)
        .flatMap((b) => Array.from(b.rows))
        .filter((r) => r.cells.length >= headers.length)
        .map((r) =>
          indexes.map((index) => {
            const cell = r.cells[index],
              raw = cell.dataset.sortValue;
            return raw != null &&
              /^-?\d+(\.\d+)?$/.test(raw) &&
              Number.isFinite(Number(raw))
              ? Number(raw)
              : clean(cell);
          }),
        );
      return {
        name:
          t.closest("details")?.querySelector("summary")?.textContent?.trim() ||
          t.closest("section")?.querySelector("h2,h3")?.textContent?.trim() ||
          `Reporte ${i + 1}`,
        headers: indexes.map((i) => headers[i]),
        rows,
      };
    })
    .filter((t) => t.headers.length > 0 && t.rows.length > 0);
}
export function reportTSV(tables: ExportTable[]): string {
  const cell = (s: unknown) => {
    const value = String(s ?? "").replace(/[\t\r\n]+/g, " ");
    return typeof s === "string" && /^\s*[=+@-]/.test(value)
      ? "'" + value
      : value;
  };
  return tables
    .map((t) =>
      [
        cell(t.name),
        t.headers.map(cell).join("\t"),
        ...t.rows.map((r) => r.map(cell).join("\t")),
      ].join("\n"),
    )
    .join("\n\n");
}
export async function reportWorkbook(
  tables: ExportTable[],
): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const add = (p: string, s: string) => (files[p] = strToU8(s));
  const names = new Set<string>();
  const sheets = tables.map((t, i) => {
    let name = t.name.replace(/[\\/?*\[\]:]/g, " ").slice(0, 25) || "Reporte";
    const base = name;
    let suffix = 2;
    while (names.has(name)) name = `${base} ${suffix++}`;
    names.add(name);
    return { ...t, name };
  });
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((t, i) => `<sheet name="${xml(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  add(
    "xl/styles.xml",
    `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF233D5B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`,
  );
  sheets.forEach((t, i) => {
    const rows = [t.headers, ...t.rows];
    const cells = rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${column(ci)}${ri + 1}"${ri === 0 ? ' s="1"' : ""}${typeof v === "number" ? ' t="n"' : ' t="inlineStr"'}>${typeof v === "number" ? `<v>${v}</v>` : `<is><t xml:space="preserve">${xml(v)}</t></is>`}</c>`).join("")}</row>`,
      )
      .join("");
    add(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${t.headers.map((h, j) => `<col min="${j + 1}" max="${j + 1}" width="${Math.min(48, Math.max(14, h.length + 3, ...t.rows.slice(0, 100).map((r) => String(r[j] ?? "").length + 2)))}" customWidth="1"/>`).join("")}</cols><sheetData>${cells}</sheetData><autoFilter ref="A1:${column(t.headers.length - 1)}${rows.length}"/></worksheet>`,
    );
  });
  return zipSync(files, { level: 6 });
}
