import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { supabase as db } from "./client";
import {
  columns,
  visualOrder,
  pasteLayout,
  comparison,
  classifications,
  manualColumns,
  blankRow,
  parseTSV,
  formatTSV,
  parseNumber,
  parseDate,
  normalize,
  findUnit,
  validateRow,
  incompleteWarnings,
  calculate,
} from "./sheet-model";
import type { SheetRow, CatalogRow } from "./sheet-model";
import "./sheet.css";
import CatalogFilters, {
  classificationMatches,
  originMatches,
} from "./CatalogFilters";
import {
  hydrateIdentity,
  editIdentity,
  identityErrors,
} from "./sheet-identity";
import { linkedBarcode, prefixFor } from "./catalog-model";
const displayColumns = visualOrder.map((c) => columns[c]);
const emptyRows: CatalogRow[] = [];
import { readSheet } from "./sheet-repository";
import type { SheetSnapshot } from "./sheet-repository";
type Props = {
  company: string;
  canWrite: boolean;
  catalog: {
    units: CatalogRow[];
    suppliers: CatalogRow[];
    raw_materials: CatalogRow[];
    presentations: CatalogRow[];
    catalog_origins?: CatalogRow[];
    products?: CatalogRow[];
  };
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  readSnapshot?: (
    company: string,
    includeRows?: boolean,
  ) => Promise<SheetSnapshot>;
  mode?: "catalog" | "import";
  onCancel?: () => void;
  onComplete?: (count: number) => void;
  onBarcode?: (item: CatalogRow) => void;
  suggestCodes?: (
    requests: { key: string; prefix: string }[],
  ) => Promise<{ key: string; sku: string }[]>;
};
type Point = { row: number; col: number };
const numeric = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("es-GT", { maximumFractionDigits: 6 }).format(
        value,
      );
function VsIcon({ variation }: { variation: number | null }) {
  const state = comparison(variation),
    label =
      state === "lower"
        ? "Precio menor al anterior"
        : state === "higher"
          ? "Precio mayor al anterior"
          : variation === null
            ? "Sin precios comparables"
            : "Mismo precio";
  return (
    <span
      className={`vs-icon vs-${state}`}
      role="img"
      aria-label={label}
      title={`${label}${variation === null ? "" : ` · Diferencia por unidad: ${numeric(variation)}`}`}
    >
      {state === "neutral" ? (
        "—"
      ) : (
        <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path
            d={
              state === "lower" ? "M6.5 12.5 10 16 17.5 8" : "m8 8 8 8m0-8-8 8"
            }
            fill="none"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
export default function MaterialSheet({
  company,
  canWrite,
  catalog,
  onSaved,
  onDirty,
  readSnapshot = readSheet,
  mode = "catalog",
  onCancel,
  onComplete,
  onBarcode,
  suggestCodes = async (requests) => {
    const { data, error } = await db.rpc("suggest_catalog_skus", {
      p_company: company,
      p_requests: requests,
    });
    if (error) throw error;
    return data;
  },
}: Props) {
  const importing = mode === "import";
  const [rows, setRows] = useState<SheetRow[]>([]),
    [history, setHistory] = useState<CatalogRow[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [legacyImport, setLegacyImport] = useState(false),
    [basis, setBasis] = useState("unknown");
  const [anchor, setAnchor] = useState<Point>({ row: 0, col: 0 }),
    [end, setEnd] = useState<Point>({ row: 0, col: 0 });
  const modal = useRef<HTMLElement>(null);
  const [classification, setClassification] = useState(""),
    [origin, setOrigin] = useState("");
  const reserving = useRef(new Set<string>());
  const [suggesting, setSuggesting] = useState(false);
  const [filter, setFilter] = useState("");
  const table = useRef<HTMLDivElement>(null),
    dragging = useRef(false),
    moving = useRef(false),
    batch = useRef<{ id: string; payload: string } | null>(null);
  const {
    units,
    suppliers,
    raw_materials: materials,
    presentations,
    catalog_origins: origins = emptyRows,
    products = emptyRows,
  } = catalog;
  const latestCatalog = useRef({ materials, origins });
  latestCatalog.current = { materials, origins };
  const selected = {
    r0: Math.min(anchor.row, end.row),
    r1: Math.max(anchor.row, end.row),
    c0: Math.min(anchor.col, end.col),
    c1: Math.max(anchor.col, end.col),
  };
  async function load() {
    setLoading(true);
    setError("");
    try {
      const { sheet, history: all } = await readSnapshot(company, !importing);
      setHistory(all);
      setRows(
        (importing ? [] : sheet).map((r) =>
          hydrateIdentity(
            {
              key: r.id,
              id: r.id,
              materialId: r.raw_material_id,
              priceId: r.price_id || undefined,
              currency: r.currency || "GTQ",
              dirty: false,
              mode: "update",
              legacyAmount: r.legacy_previous_amount,
              legacySupplier: r.legacy_previous_supplier,
              legacyBasis: r.legacy_previous_basis,
              cells: [
                r.supplier_name || "",
                r.alternative_name,
                r.material_name,
                r.capacity,
                String(r.quantity),
                r.unit_symbol,
                r.comment,
                r.amount === null ? "" : String(r.amount),
                "",
                "",
                "",
                "",
                r.effective_on || "",
                "",
                "",
                "",
                "",
              ],
            },
            latestCatalog.current.materials,
            latestCatalog.current.origins,
          ),
        ),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [company, importing]);
  useEffect(() => {
    if (importing && !loading)
      table.current
        ?.querySelector<HTMLInputElement>('[data-row="0"][data-col="0"]')
        ?.focus();
  }, [importing, loading]);
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (rows.some((r) => r.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [rows]);
  useEffect(() => {
    if (preview) modal.current?.focus();
  }, [preview]);
  const dirty = rows.filter((r) => r.dirty);
  useEffect(() => {
    onDirty(dirty.length > 0);
    return () => onDirty(false);
  }, [dirty.length, onDirty]);
  const materialIds = useMemo(
    () => new Map(materials.map((m) => [normalize(m.name), m.id])),
    [materials],
  );
  function computeResult(r: SheetRow) {
    const materialKey = (row: SheetRow) =>
      row.materialId ||
      materialIds.get(normalize(row.cells[2])) ||
      "draft-material:" + normalize(row.cells[2]);
    const extraMaterials: CatalogRow[] = [...materials];
    if (!extraMaterials.some((m) => m.id === materialKey(r)))
      extraMaterials.push({ id: materialKey(r), name: r.cells[2] });
    const extraPresentations: CatalogRow[] = [...presentations],
      extraSuppliers: CatalogRow[] = [...suppliers],
      extraHistory: CatalogRow[] = [...history];
    const date = parseDate(r.cells[12]),
      currentIndex = rows.indexOf(r);
    rows.forEach((other, index) => {
      if (other === r || !other.dirty || materialKey(other) !== materialKey(r))
        return;
      const previousDate = parseDate(other.cells[12]),
        unit = findUnit(other.cells[5], units),
        quantity = parseNumber(other.cells[4]),
        amount = parseNumber(other.cells[7]);
      if (
        !date ||
        !previousDate ||
        previousDate > date ||
        (previousDate === date && index >= currentIndex) ||
        !unit ||
        !quantity ||
        amount === null
      )
        return;
      const old = history.find((h) => h.id === other.priceId),
        pack = presentations.find((p) => p.id === other.id),
        supplier = suppliers.find(
          (s) => normalize(s.name) === normalize(other.cells[0]),
        );
      if (
        old &&
        Number(old.amount) === amount &&
        old.effective_on === previousDate &&
        Number(pack?.quantity) === quantity &&
        pack?.unit_id === unit.id &&
        pack?.supplier_id === (supplier?.id ?? null)
      )
        return;
      const id = "draft:" + other.key,
        sid = supplier?.id || id;
      extraPresentations.push({
        id,
        raw_material_id: materialKey(other),
        supplier_id: sid,
        unit_id: unit.id,
        quantity,
      });
      if (!extraSuppliers.some((s) => s.id === sid))
        extraSuppliers.push({ id: sid, name: other.cells[0] });
      extraHistory.push({
        id,
        presentation_id: id,
        amount,
        currency: other.currency,
        effective_on: previousDate,
        created_at: new Date(Date.now() + index).toISOString(),
      });
    });
    return calculate(
      { ...r, materialId: materialKey(r) },
      units,
      extraPresentations,
      extraMaterials,
      extraSuppliers,
      extraHistory,
      legacyImport,
      basis,
    );
  }
  const calculations = useMemo(
    () => new Map(rows.map((r) => [r.key, computeResult(r)])),
    [
      rows,
      units,
      presentations,
      materials,
      suppliers,
      history,
      legacyImport,
      basis,
    ],
  );
  function result(r: SheetRow) {
    return calculations.get(r.key)!;
  }
  function value(r: SheetRow, position: number) {
    const c = visualOrder[position];
    const calc = result(r);
    if (c === 8) return numeric(calc.current);
    if (c === 9) return numeric(calc.variation);
    if (c === 10)
      return numeric(calc.previousDisplay) + (calc.unknown ? " *" : "");
    if (c === 11) return calc.previousSupplier;
    return r.cells[c] || "";
  }
  function editable(position: number) {
    const c = visualOrder[position];
    return (
      canWrite &&
      (manualColumns.includes(c) || (legacyImport && (c === 10 || c === 11)))
    );
  }
  function groupKey(r: SheetRow) {
    return r.materialId || normalize(r.cells[2]) || r.key;
  }
  async function suggestRows(draft: SheetRow[]) {
    const requests = new Map<string, { key: string; prefix: string }>();
    for (const row of draft) {
      const prefix = prefixFor("material", row.cells[14] || ""),
        key = groupKey(row);
      if (
        !prefix ||
        row.id ||
        row.cells[13] ||
        row.skuTouched ||
        reserving.current.has(key) ||
        materials.some(
          (m) =>
            m.id === row.materialId ||
            normalize(m.name) === normalize(row.cells[2]),
        )
      )
        continue;
      requests.set(key, { key, prefix });
    }
    if (!requests.size) return;
    requests.forEach((_, key) => reserving.current.add(key));
    setSuggesting(true);
    try {
      const codes = await suggestCodes([...requests.values()]);
      setRows((old) =>
        old.map((r) => {
          const code = codes.find((c) => c.key === groupKey(r)),
            request = requests.get(groupKey(r));
          if (
            !code ||
            !request ||
            r.cells[13] ||
            r.skuTouched ||
            prefixFor("material", r.cells[14] || "") !== request.prefix
          )
            return r;
          const next = {
            ...r,
            cells: [...r.cells],
            metadataEdited: true,
            dirty: true,
          };
          next.cells[13] = code.sku;
          next.cells[16] = linkedBarcode(
            code.sku,
            r.cells[16] || "",
            !!r.barcodeCustom,
          );
          return next;
        }),
      );
    } catch (e: any) {
      setError(
        "No se pudo sugerir el SKU. Puedes escribirlo o dejarlo vacío. " +
          e.message,
      );
    } finally {
      requests.forEach((_, key) => reserving.current.delete(key));
      setSuggesting(reserving.current.size > 0);
    }
  }
  useEffect(() => {
    void suggestRows(rows);
  }, [rows]);
  function change(index: number, position: number, text: string) {
    const col = visualOrder[position],
      source = index === rows.length ? [...rows, blankRow()] : rows;
    const next = source.map((r, i) => {
      if (i !== index) return r;
      let row = editIdentity(hydrateIdentity(r, materials, origins), col, text);
      if (col === 10) row.importedPrevious = text;
      if (col === 11) row.importedSupplier = text;
      if (col === 7 && /^(USD|\$)/i.test(text.trim())) row.currency = "USD";
      else if (col === 7 && /^Q/i.test(text.trim())) row.currency = "GTQ";
      if (col === 2 && !row.id) {
        const match = materials.find(
          (m) => normalize(m.name) === normalize(text),
        );
        if (match && !row.skuTouched) {
          row.cells[13] = match.sku || "";
          if (!row.barcodeCustom) {
            row.cells[16] = match.barcode || "";
            row.barcodeCustom = !!match.barcode_custom;
          }
        }
        if (!row.metadataEdited) row = hydrateIdentity(row, materials, origins);
      }
      return row;
    });
    // Metadata belongs to a material, shared by all its presentations.
    if (col >= 13) {
      const changed = next[index],
        key = groupKey(changed);
      for (let i = 0; i < next.length; i++)
        if (i !== index && groupKey(next[i]) === key)
          next[i] = editIdentity(next[i], col, text);
    }
    setRows(next);
    if (index === rows.length)
      requestAnimationFrame(() => {
        const input = table.current?.querySelector<HTMLElement>(
          `[data-row="${index}"][data-col="${position}"]`,
        );
        input?.focus();
        if (input instanceof HTMLInputElement)
          input.setSelectionRange(text.length, text.length);
      });
    setNotice(
      importing ? "" : "Cambios pendientes. Revisa el lote antes de guardar.",
    );
  }
  function focus(p: Point) {
    setEnd(p);
    moving.current = true;
    table.current
      ?.querySelector<HTMLElement>(`[data-row="${p.row}"][data-col="${p.col}"]`)
      ?.focus();
    moving.current = false;
  }
  function select(p: Point, extend = false) {
    if (!extend) setAnchor(p);
    setEnd(p);
  }
  function paste(e: ClipboardEvent) {
    if (!canWrite || busy) return;
    e.preventDefault();
    setError("");
    setFilter("");
    setClassification("");
    setOrigin("");
    try {
      const text = e.clipboardData.getData("text/plain");
      if (importing && !rows.length && !text.trim())
        throw Error(
          "El portapapeles no contiene datos de una tabla. Copia las celdas en Excel e intenta de nuevo.",
        );
      const start = { row: selected.r0, col: selected.c0 };
      const { matrix, mapping } = pasteLayout(parseTSV(text), start.col);
      if (!matrix.length) return;
      if (matrix.length > 500)
        throw Error("Pega como máximo 500 filas por lote.");
      const hasHistorical = matrix.some((line) =>
        line.some((text, ci) => [10, 11].includes(mapping[ci]) && text.trim()),
      );
      if (hasHistorical) setLegacyImport(true);
      const next = rows.map((r) => ({ ...r, cells: [...r.cells] }));
      while (next.length < start.row + matrix.length) next.push(blankRow());
      matrix.forEach((line, ri) => {
        let row = next[start.row + ri];
        line.forEach((text, ci) => {
          const col = mapping[ci];
          if (
            (col < 13 && manualColumns.includes(col)) ||
            ([10, 11].includes(col) && (legacyImport || hasHistorical))
          ) {
            row.cells[col] = text;
            row.dirty = true;
            row.duplicateChoice = undefined;
            if (col === 7 && /^(USD|\$)/i.test(text.trim()))
              row.currency = "USD";
            else if (col === 7 && /^Q/i.test(text.trim())) row.currency = "GTQ";
            if (col === 10) row.importedPrevious = text;
            if (col === 11) row.importedSupplier = text;
          }
        });
        row = hydrateIdentity(row, materials, origins);
        const existing = materials.find(
          (m) =>
            m.id === row.materialId ||
            normalize(m.name) === normalize(row.cells[2]),
        );
        // Apply optional metadata AFTER locating the material: omitted columns preserve
        // its existing values, even for partial, reordered, header-based imports.
        line.forEach((text, ci) => {
          const col = mapping[ci];
          if (col < 13) return;
          row.cells[col] = text;
          row.metadataEdited = true;
          row.dirty = true;
          if (col === 13 && (text.trim() || row.id)) row.skuTouched = true;
        });
        if (mapping.includes(16))
          row.barcodeCustom =
            !!existing?.barcode_custom ||
            String(row.cells[16] || "").trim() !==
              String(row.cells[13] || "").trim();
        else if (mapping.includes(13))
          row.cells[16] = linkedBarcode(
            row.cells[13] || "",
            row.cells[16] || "",
            !!row.barcodeCustom,
          );
        next[start.row + ri] = row;
      });
      setRows(next);
      start.col = Math.min(...mapping.map((c) => visualOrder.indexOf(c)));
      setAnchor(start);
      setEnd({
        row: start.row + matrix.length - 1,
        col: Math.max(...mapping.map((c) => visualOrder.indexOf(c))),
      });
      setNotice(
        importing
          ? `${matrix.length} filas pegadas. Puedes editar las celdas antes de guardar.`
          : `${matrix.length} fila(s) pegadas. PRECIO UN y VS se recalculan; los valores copiados en esas columnas se ignoran. Revisa antes de guardar.`,
      );
      requestAnimationFrame(() => {
        moving.current = true;
        table.current
          ?.querySelector<HTMLElement>(
            `[data-row="${start.row}"][data-col="${start.col}"]`,
          )
          ?.focus();
        moving.current = false;
      });
    } catch (e: any) {
      setError(e.message);
    }
  }
  function visibleRow(r: SheetRow) {
    return (
      (!filter ||
        r.cells.some((c) => normalize(c).includes(normalize(filter)))) &&
      classificationMatches(r.cells[14], classification) &&
      originMatches(origins.find((o) => o.name === r.cells[15])?.id, origin)
    );
  }
  function copy(e: ClipboardEvent) {
    const matrix = rows
      .slice(selected.r0, selected.r1 + 1)
      .filter(visibleRow)
      .map((r) =>
        displayColumns
          .slice(selected.c0, selected.c1 + 1)
          .map((_, i) => value(r, selected.c0 + i).replace(/ \*$/, "")),
      );
    if (!matrix.length) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", formatTSV(matrix));
  }
  function key(e: KeyboardEvent) {
    if (e.target instanceof HTMLSelectElement && e.key !== "Tab") return;
    const arrows: Record<string, Point> = {
      ArrowUp: { row: -1, col: 0 },
      ArrowDown: { row: 1, col: 0 },
      ArrowLeft: { row: 0, col: -1 },
      ArrowRight: { row: 0, col: 1 },
      Enter: { row: 1, col: 0 },
      Tab: { row: 0, col: e.shiftKey ? -1 : 1 },
    };
    if (e.key === "Escape") {
      setAnchor(end);
      return;
    }
    if (e.key === "Delete" && e.shiftKey && canWrite) {
      e.preventDefault();
      setRows((old) =>
        old.map((r, ri) => {
          if (ri < selected.r0 || ri > selected.r1 || !visibleRow(r)) return r;
          const next = { ...r, cells: [...r.cells], dirty: true };
          for (let c = selected.c0; c <= selected.c1; c++)
            if (editable(c)) {
              const logical = visualOrder[c];
              const edited = editIdentity(next, logical, "");
              Object.assign(next, edited);
              if (logical === 10) next.importedPrevious = "";
              if (logical === 11) next.importedSupplier = "";
            }
          return next;
        }),
      );
      return;
    }
    const move = arrows[e.key];
    if (!move) return;
    if (
      !e.shiftKey &&
      !["Enter", "Tab", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    e.preventDefault();
    const p = {
      row: Math.max(0, Math.min(rows.length - 1, end.row + move.row)),
      col: Math.max(0, Math.min(displayColumns.length - 1, end.col + move.col)),
    };
    if (!e.shiftKey || e.key === "Tab") setAnchor(p);
    focus(p);
  }
  function matches(r: SheetRow) {
    const u = findUnit(r.cells[5], units);
    return presentations.filter(
      (p) =>
        p.active &&
        p.raw_material_id ===
          (r.materialId ||
            materials.find((m) => normalize(m.name) === normalize(r.cells[2]))
              ?.id) &&
        p.supplier_id ===
          (suppliers.find((s) => normalize(s.name) === normalize(r.cells[0]))
            ?.id ?? null) &&
        p.unit_id === u?.id &&
        Number(p.quantity) === parseNumber(r.cells[4]) &&
        normalize(p.capacity || "") === normalize(r.cells[3]),
    );
  }
  function duplicate(r: SheetRow) {
    return (
      !r.id &&
      (matches(r).length > 0 ||
        rows.some(
          (other) =>
            other.key !== r.key &&
            [0, 2, 3].every(
              (c) => normalize(other.cells[c]) === normalize(r.cells[c]),
            ) &&
            parseNumber(other.cells[4]) === parseNumber(r.cells[4]) &&
            findUnit(other.cells[5], units)?.id ===
              findUnit(r.cells[5], units)?.id,
        ))
    );
  }
  const rowLimitError = dirty.length > 500;
  const validate = (r: SheetRow) => [
    ...validateRow(r, units, suppliers, materials),
    ...identityErrors(r, rows, materials, products, origins),
  ];
  const errors = dirty.flatMap((r) =>
    validate(r).map((message) => ({
      key: r.key,
      message,
      row: rows.indexOf(r) + 1,
    })),
  );
  const warnings = dirty.flatMap((r) =>
    incompleteWarnings(r).map((message) => ({
      key: r.key,
      message,
      row: rows.indexOf(r) + 1,
    })),
  );
  const duplicateMissing = dirty.some(
    (r) => duplicate(r) && !r.duplicateChoice,
  );
  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = dirty.map((r) => ({
        ...(r.metadataEdited
          ? {
              sku: (r.cells[13] || "").trim(),
              classification: r.cells[14] || "",
              origin: r.cells[15] || "",
              barcode: (r.cells[16] || "").trim(),
              barcodeCustom: !!r.barcodeCustom,
            }
          : {}),
        id: r.id || "",
        expectedPriceId: r.priceId || null,
        mode: r.mode,
        confirmedDuplicate: r.duplicateChoice || false,
        supplier: r.cells[0].trim(),
        alternative: r.cells[1].trim(),
        material: r.cells[2].trim(),
        capacity: r.cells[3].trim(),
        quantity: parseNumber(r.cells[4]),
        unit: r.cells[5].trim(),
        comment: r.cells[6],
        price: parseNumber(r.cells[7]),
        date: parseDate(r.cells[12]),
        currency: r.currency,
        previous:
          legacyImport && r.importedPrevious !== undefined
            ? parseNumber(r.importedPrevious)
            : (r.legacyAmount ?? null),
        previousSupplier:
          legacyImport && r.importedSupplier !== undefined
            ? r.importedSupplier
            : (r.legacySupplier ?? ""),
        previousBasis:
          legacyImport && r.importedPrevious !== undefined
            ? basis
            : (() => {
                const prior = history.find((h) => h.id === r.priceId),
                  pack = presentations.find((p) => p.id === r.id);
                return !prior ||
                  (prior.currency === r.currency &&
                    pack?.unit_id === findUnit(r.cells[5], units)?.id &&
                    Number(pack?.quantity) === parseNumber(r.cells[4]) &&
                    String(parseDate(r.cells[12])) >= prior.effective_on)
                  ? r.legacyBasis || "unknown"
                  : "unknown";
              })(),
      }));
      const encoded = JSON.stringify(payload);
      if (!batch.current || batch.current.payload !== encoded)
        batch.current = { id: crypto.randomUUID(), payload: encoded };
      const { error } = await db.rpc("save_material_sheet", {
        p_company: company,
        p_batch: batch.current.id,
        p_rows: payload,
      });
      if (error) throw error;
      setRows((old) => old.map((r) => ({ ...r, dirty: false })));
      setPreview(false);
      await onSaved();
      if (importing && onComplete) {
        batch.current = null;
        onComplete(dirty.length);
        return;
      }
      await load();
      batch.current = null;
      setNotice(
        `${dirty.length} fila(s) guardadas. El historial anterior se conservó.`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(
        formatTSV([
          displayColumns,
          ...rows
            .filter(visibleRow)
            .map((r) =>
              displayColumns.map((_, c) => value(r, c).replace(/ \*$/, "")),
            ),
        ]),
      );
      setNotice("Tabla copiada con encabezados. Puedes pegarla en Excel.");
    } catch {
      setError("Selecciona un rango en la tabla y pulsa Ctrl+C para copiar.");
    }
  }
  function add() {
    const index = rows.length;
    setRows((old) => [...old, blankRow()]);
    setFilter("");
    setClassification("");
    setOrigin("");
    setAnchor({ row: index, col: 0 });
    setEnd({ row: index, col: 0 });
    setTimeout(() => focus({ row: index, col: 0 }), 0);
  }
  function cancelImport() {
    if (busy) return;
    if (
      dirty.length &&
      !window.confirm("¿Cancelar esta carga y descartar los datos sin guardar?")
    )
      return;
    onCancel?.();
  }
  function selectOptions(col: number, current = "") {
    return col === 14 ? (
      <>
        <option value="">Pendiente de clasificar</option>
        {classifications.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </>
    ) : (
      <>
        <option value="">Pendiente de definir</option>
        {origins
          .filter((o) => o.active || o.name === current)
          .map((o) => (
            <option key={o.id} value={o.name}>
              {o.name}
              {o.active ? "" : " (inactivo)"}
            </option>
          ))}
      </>
    );
  }
  const placeholderRow = (
    <tr key="paste-placeholder" className="sheet-placeholder-row">
      <th scope="row">{rows.length + 1}</th>
      {displayColumns.map((col, ci) => (
        <td key={col} className={editable(ci) ? "" : "cell-auto"}>
          {editable(ci) ? (
            [14, 15].includes(visualOrder[ci]) ? (
              <select
                data-row={rows.length}
                data-col={ci}
                aria-label={`Nueva fila ${col}`}
                value=""
                disabled={busy}
                onFocus={() => select({ row: rows.length, col: ci })}
                onChange={(e) => change(rows.length, ci, e.target.value)}
              >
                {selectOptions(visualOrder[ci])}
              </select>
            ) : (
              <input
                data-row={rows.length}
                data-col={ci}
                aria-label={`${rows.length ? "Nueva fila" : "Pegar datos"} ${col}`}
                placeholder={
                  !rows.length && ci === 0 ? "Pega aquí desde Excel" : ""
                }
                list={
                  visualOrder[ci] === 0
                    ? "sheet-suppliers"
                    : visualOrder[ci] === 5
                      ? "sheet-units"
                      : undefined
                }
                disabled={busy}
                onFocus={() => select({ row: rows.length, col: ci })}
                onPointerDown={(e) =>
                  select({ row: rows.length, col: ci }, e.shiftKey)
                }
                onChange={(e) => change(rows.length, ci, e.target.value)}
              />
            )
          ) : (
            <span aria-label={`${col} calculado`}>—</span>
          )}
        </td>
      ))}
    </tr>
  );
  return (
    <section className={`sheet-panel ${importing ? "sheet-import" : ""}`}>
      {importing ? (
        <div className="import-heading">
          <div>
            <p className="eyebrow">CARGA MASIVA</p>
            <h2>Copiar de Tabla</h2>
            <p>
              Haz clic en la primera celda y pega tus datos de Excel. Las filas
              se crean automáticamente.
              <span className="required-fields">
                Solo MATERIAL, unidad de medida y cantidad son obligatorios.
              </span>
            </p>
          </div>
          <div className="import-actions">
            <button
              disabled={!dirty.length || busy || loading || suggesting}
              onClick={() => {
                setPreview(true);
                setError("");
              }}
            >
              Guardar
            </button>
            <button
              data-cancel-import
              className="secondary"
              disabled={busy}
              onClick={cancelImport}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sheet-heading">
            <div>
              <h2>Materiales · hoja de trabajo</h2>
              <p>
                Una fila por presentación. Selecciona una celda y pega desde
                Excel. Arrastra o usa Mayús + clic para seleccionar un rango.
              </p>
            </div>
            <button className="secondary" onClick={() => void copyAll()}>
              Copiar tabla
            </button>
          </div>
          <div className="sheet-controls">
            <input
              aria-label="Buscar en la hoja"
              placeholder="Buscar material o proveedor…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {canWrite && (
              <>
                <button className="secondary" onClick={add}>
                  + Fila nueva
                </button>
                <button
                  disabled={!dirty.length || busy || suggesting}
                  onClick={() => {
                    setPreview(true);
                    setError("");
                  }}
                >
                  Revisar {dirty.length || ""} cambios
                </button>
                <button
                  className="secondary"
                  disabled={!dirty.length || busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "¿Descartar todos los cambios sin guardar de la hoja?",
                      )
                    )
                      return;
                    setPreview(false);
                    void load();
                    setNotice("Cambios sin guardar descartados.");
                  }}
                >
                  Descartar cambios
                </button>
              </>
            )}
          </div>
        </>
      )}
      {!importing && (
        <CatalogFilters
          classification={classification}
          onClassification={setClassification}
          origin={origin}
          onOrigin={setOrigin}
          origins={origins}
        />
      )}
      <details className={importing ? "import-options" : "sheet-options"}>
        <summary>Opciones de históricos y ayuda</summary>
        {canWrite && (
          <div className="sheet-migration">
            <label>
              <input
                type="checkbox"
                checked={legacyImport}
                onChange={(e) => setLegacyImport(e.target.checked)}
              />{" "}
              Importación inicial: conservar precio y proveedor anteriores de
              Excel
            </label>
            {legacyImport && (
              <label>
                Interpretación del precio anterior
                <select
                  aria-label="Interpretación del precio anterior"
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                >
                  <option value="unknown">
                    Sin unidad conocida: conservar referencia, sin VS
                  </option>
                  <option value="unit">
                    Precio por la misma unidad de esta fila
                  </option>
                  <option value="presentation">
                    Precio total de la misma cantidad y unidad de esta fila
                  </option>
                </select>
              </label>
            )}
          </div>
        )}
        <p className="sheet-legend">
          <span>Editable</span>
          <span>▧ Calculado / solo lectura</span> CAPACIDAD es informativa.
          PRECIO UN = precio ÷ presentación. VS se expresa en la unidad de la
          fila y la misma moneda.{" "}
          <b>* Referencia histórica sin unidad o fecha conocida.</b>
        </p>
      </details>
      {notice && (
        <p role="status" className="sheet-notice">
          {notice}
        </p>
      )}
      {suggesting && (
        <p className="sheet-notice" role="status">
          Sugiriendo SKU para los materiales nuevos…
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Cargando hoja…</p>
      ) : (
        <div
          ref={table}
          tabIndex={importing ? 0 : undefined}
          aria-label={
            importing ? "Tabla de carga masiva: pega aquí tus datos" : undefined
          }
          className="sheet-scroll"
          onPaste={paste}
          onCopy={copy}
          onKeyDown={key}
        >
          <table className="sheet-table" aria-label="Hoja de materiales">
            <thead>
              <tr>
                <th>#</th>
                {displayColumns.map((col, c) => (
                  <th key={col} scope="col">
                    {col}
                    {[2, 4, 5].includes(visualOrder[c]) ? " *" : ""}
                    <small>
                      {manualColumns.includes(visualOrder[c])
                        ? "Manual"
                        : visualOrder[c] === 10 || visualOrder[c] === 11
                          ? "Historial / importación"
                          : "Automático"}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                if (!visibleRow(r)) return null;
                const rowErrors = validate(r),
                  rowWarnings = incompleteWarnings(r);
                return (
                  <tr key={r.key} className={r.dirty ? "pending" : ""}>
                    <th scope="row">
                      <span>
                        {ri + 1}
                        {r.dirty ? " •" : ""}
                      </span>
                      {r.dirty && rowErrors.length > 0 && (
                        <span
                          className="row-error-marker"
                          role="img"
                          aria-label={`Fila ${ri + 1}: ${rowErrors.join(" · ")}`}
                          title={rowErrors.join(" · ")}
                        >
                          !
                        </span>
                      )}
                      {r.dirty &&
                        !rowErrors.length &&
                        rowWarnings.length > 0 && (
                          <span
                            className="row-warning-marker"
                            role="img"
                            aria-label={`Fila ${ri + 1}: ${rowWarnings.join(" · ")}`}
                            title={rowWarnings.join(" · ")}
                          >
                            !
                          </span>
                        )}
                      {!importing && !r.id && canWrite && (
                        <button
                          aria-label={`Quitar fila nueva ${ri + 1}`}
                          className="remove-row"
                          onClick={() =>
                            setRows((old) =>
                              old.filter((row) => row.key !== r.key),
                            )
                          }
                        >
                          ×
                        </button>
                      )}
                    </th>
                    {displayColumns.map((col, ci) => {
                      const chosen =
                        ri >= selected.r0 &&
                        ri <= selected.r1 &&
                        ci >= selected.c0 &&
                        ci <= selected.c1;
                      const isEditable = editable(ci);
                      const shown =
                        visualOrder[ci] === 10 && legacyImport
                          ? (r.importedPrevious ??
                            (r.legacyAmount == null
                              ? ""
                              : String(r.legacyAmount)))
                          : visualOrder[ci] === 11 && legacyImport
                            ? (r.importedSupplier ?? r.legacySupplier ?? "")
                            : value(r, ci);
                      return (
                        <td
                          key={col}
                          className={`${chosen ? "cell-selected " : ""}${isEditable ? "" : "cell-auto"} ${visualOrder[ci] === 16 ? "barcode-cell" : ""}`}
                          title={
                            r.dirty && (rowErrors.length || rowWarnings.length)
                              ? [...rowErrors, ...rowWarnings].join(" · ")
                              : visualOrder[ci] === 10
                                ? "El historial se compara por unidad; referencias importadas sin fecha conocida se conservan sin inventar fechas."
                                : col
                          }
                          onPointerDown={(e) => {
                            dragging.current = true;
                            select({ row: ri, col: ci }, e.shiftKey);
                            if (e.shiftKey) e.preventDefault();
                          }}
                          onPointerEnter={() => {
                            if (dragging.current) setEnd({ row: ri, col: ci });
                          }}
                        >
                          {isEditable ? (
                            [14, 15].includes(visualOrder[ci]) ? (
                              <select
                                data-row={ri}
                                data-col={ci}
                                aria-label={`Fila ${ri + 1} ${col}`}
                                value={shown}
                                disabled={busy}
                                onFocus={() => {
                                  if (!dragging.current && !moving.current)
                                    select({ row: ri, col: ci });
                                }}
                                onChange={(e) => change(ri, ci, e.target.value)}
                              >
                                {selectOptions(visualOrder[ci], shown)}
                              </select>
                            ) : (
                              <input
                                data-row={ri}
                                data-col={ci}
                                aria-label={`Fila ${ri + 1} ${col}`}
                                value={shown}
                                list={
                                  visualOrder[ci] === 0
                                    ? "sheet-suppliers"
                                    : visualOrder[ci] === 5
                                      ? "sheet-units"
                                      : undefined
                                }
                                inputMode={
                                  [4, 7, 10].includes(visualOrder[ci])
                                    ? "decimal"
                                    : undefined
                                }
                                disabled={busy}
                                onFocus={() => {
                                  if (!dragging.current && !moving.current)
                                    select({ row: ri, col: ci });
                                }}
                                onChange={(e) => change(ri, ci, e.target.value)}
                              />
                            )
                          ) : (
                            <span
                              tabIndex={0}
                              data-row={ri}
                              data-col={ci}
                              aria-label={`Fila ${ri + 1} ${col}`}
                              onFocus={() => {
                                if (!dragging.current && !moving.current)
                                  select({ row: ri, col: ci });
                              }}
                            >
                              {visualOrder[ci] === 9 ? (
                                <VsIcon variation={result(r).variation} />
                              ) : (
                                shown || "—"
                              )}
                            </span>
                          )}
                          {visualOrder[ci] === 16 &&
                            r.cells[16] &&
                            onBarcode && (
                              <button
                                type="button"
                                className="barcode-cell-action"
                                aria-label={`Ver código de barras fila ${ri + 1}`}
                                title="Ver código de barras"
                                onClick={() =>
                                  onBarcode({
                                    id: r.materialId || r.key,
                                    name: r.cells[2],
                                    sku: r.cells[13],
                                    barcode: r.cells[16],
                                    draft: r.dirty,
                                  })
                                }
                              >
                                ▥
                              </button>
                            )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {importing && canWrite && placeholderRow}
            </tbody>
          </table>
        </div>
      )}
      {!importing && !loading && !rows.length && (
        <div className="empty">
          <h2>Tu hoja está lista</h2>
          <p>Agrega una fila, selecciona SKU y pega tus filas de Excel.</p>
          {canWrite && <button onClick={add}>+ Primera fila</button>}
        </div>
      )}
      <datalist id="sheet-suppliers">
        {suppliers
          .filter((s) => s.active)
          .map((s) => (
            <option key={s.id} value={s.name} />
          ))}
      </datalist>
      <datalist id="sheet-units">
        {units
          .filter((u) => u.active)
          .map((u) => (
            <option key={u.id} value={u.symbol}>
              {u.name}
            </option>
          ))}
      </datalist>
      <p className="muted sheet-footnote">
        {importing ? (
          `${rows.length} filas para cargar · ${errors.length ? `${new Set(errors.map((e) => e.key)).size} con errores por corregir` : warnings.length ? `${new Set(warnings.map((w) => w.key)).size} con datos pendientes (puedes guardar)` : "Máximo 500 filas por carga"}`
        ) : (
          <>
            {rows.length} filas · {dirty.length} pendientes · Pega hasta 500
            filas por lote · Mayús + Supr vacía el rango editable. Los cambios
            no se guardan hasta confirmar. Guarda antes de cambiar de sección o
            empresa.
          </>
        )}
      </p>
      {preview && (
        <div className="overlay">
          <section
            ref={modal}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                e.preventDefault();
                e.stopPropagation();
                setPreview(false);
                return;
              }
              if (e.key === "Tab") {
                const controls = Array.from(
                  modal.current?.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),select:not(:disabled),input:not(:disabled)",
                  ) || [],
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (
                  e.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === modal.current)
                ) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
            className="modal sheet-preview"
            role="dialog"
            aria-modal="true"
            aria-label="Vista previa de cambios"
          >
            <button
              className="close"
              aria-label="Cerrar vista previa"
              disabled={busy}
              onClick={() => setPreview(false)}
            >
              ×
            </button>
            <p className="eyebrow">REVISAR ANTES DE GUARDAR</p>
            <h2>{dirty.length} filas pendientes</h2>
            <p>
              Se guardan juntas. Cualquier error cancela el lote completo. Los
              precios anteriores se conservan como historial. Una fecha futura
              se guarda como cotización programada; será vigente desde esa
              fecha. Nombre, nombre alternativo, SKU, clasificación, origen y
              código de barras pertenecen al material y se comparten entre sus
              presentaciones.
            </p>
            {warnings.length > 0 && (
              <div className="sheet-warning" role="status">
                Hay {new Set(warnings.map((w) => w.key)).size} filas con datos
                opcionales pendientes. Puedes guardar y completarlos después.
              </div>
            )}
            {rowLimitError && (
              <p role="alert" className="error">
                Guarda como máximo 500 filas por lote.
              </p>
            )}
            {errors.length > 0 && (
              <div role="alert" className="error">
                {errors.map((e, i) => (
                  <p key={i}>
                    Fila {e.row}: {e.message}
                  </p>
                ))}
                <p>Cierra esta vista y corrige las celdas indicadas.</p>
              </div>
            )}
            <div className="sheet-preview-list">
              {dirty.map((r) => {
                const calc = result(r),
                  isDuplicate = duplicate(r),
                  newSupplier =
                    !!r.cells[0].trim() &&
                    !suppliers.some(
                      (s) => normalize(s.name) === normalize(r.cells[0]),
                    );
                return (
                  <article key={r.key}>
                    <strong>
                      Fila {rows.indexOf(r) + 1}: {r.cells[2] || "Sin nombre"}
                    </strong>
                    <p>
                      {r.cells[0] || "Sin proveedor"}
                      {newSupplier ? " · Se creará este proveedor" : ""} ·{" "}
                      {r.cells[4]} {r.cells[5]} ·{" "}
                      {r.cells[7].trim()
                        ? `${r.currency} ${r.cells[7]}`
                        : "Precio pendiente"}{" "}
                      ·{" "}
                      {parseDate(r.cells[12]) ||
                        (r.cells[12].trim()
                          ? "Fecha inválida"
                          : "Fecha pendiente")}
                    </p>
                    {incompleteWarnings(r).map((message) => (
                      <p className="sheet-warning-text" key={message}>
                        {message}
                      </p>
                    ))}
                    <p>
                      Precio UN: {numeric(calc.current)} · VS:{" "}
                      <VsIcon variation={calc.variation} />{" "}
                      {numeric(calc.variation)}
                      {calc.unknown
                        ? " · Antecedente sin unidad conocida, no comparable"
                        : ""}
                    </p>
                    {r.importedPrevious && legacyImport && (
                      <p>
                        Antecedente importado: {r.importedPrevious} ·{" "}
                        {r.importedSupplier || "Proveedor no indicado"} · Fecha
                        desconocida
                      </p>
                    )}
                    {isDuplicate && (
                      <label>
                        Posible duplicado: elige cómo guardar
                        <select
                          aria-label={`Duplicado fila ${rows.indexOf(r) + 1}`}
                          value={r.duplicateChoice ? r.mode : ""}
                          onChange={(e) =>
                            setRows((old) =>
                              old.map((item) =>
                                item.key === r.key
                                  ? {
                                      ...item,
                                      mode: e.target.value as "add" | "update",
                                      duplicateChoice: !!e.target.value,
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="">Seleccionar…</option>
                          <option value="update">
                            Actualizar coincidencia y añadir precio al historial
                          </option>
                          <option value="add">
                            Agregar otra presentación intencionalmente
                          </option>
                        </select>
                      </label>
                    )}
                    {r.id && (
                      <p className="muted">
                        Actualizar fila existente. Si cambia el proveedor o
                        contenido, se conserva la presentación anterior
                        archivada.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              disabled={
                busy ||
                suggesting ||
                rowLimitError ||
                !!errors.length ||
                duplicateMissing ||
                !dirty.length
              }
              onClick={() => void save()}
            >
              {busy
                ? "Guardando lote…"
                : `Confirmar y guardar ${dirty.length} filas`}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
