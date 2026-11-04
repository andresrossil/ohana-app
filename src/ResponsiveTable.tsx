import SearchSelect from "./SearchSelect";
import {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useState,
  useRef,
  useLayoutEffect,
} from "react";
import type { ReactElement, ReactNode, TableHTMLAttributes } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { cellSortText, compareCells } from "./table-sort";
type Element = ReactElement<{
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  readOnly?: boolean;
  onChange?: unknown;
  type?: string;
  scope?: string;
  "aria-sort"?: "none" | "ascending" | "descending" | "other";
}>;
function elements(children: ReactNode): Element[] {
  return Children.toArray(children).flatMap((n) =>
    isValidElement(n)
      ? n.type === Fragment
        ? elements((n.props as { children?: ReactNode }).children)
        : [n as Element]
      : [],
  );
}
function text(children: ReactNode): string {
  return Children.toArray(children)
    .map((n) =>
      typeof n === "string" || typeof n === "number"
        ? String(n)
        : isValidElement(n)
          ? text((n.props as { children?: ReactNode }).children)
          : "",
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
function editable(children: ReactNode): boolean {
  return elements(children).some(
    (n) =>
      !n.props.readOnly &&
      (["input", "select", "textarea"].includes(String(n.type)) ||
        typeof n.props.onChange === "function" ||
        editable(n.props.children)),
  );
}
export default forwardRef<
  HTMLTableElement,
  TableHTMLAttributes<HTMLTableElement> & {
    onSortRows?: (indexes: number[]) => void;
  }
>(function ResponsiveTable(
  { children, className, onInvalidCapture, onSortRows, ...props },
  ref,
) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set()),
    parts = elements(children);
  const table = useRef<HTMLTableElement | null>(null);
  const [sort, setSort] = useState<{
    column: number;
    direction: "asc" | "desc";
    values: Record<string, string>;
  } | null>(null);
  const [mobileColumn, setMobileColumn] = useState("");
  const head = parts.find((n) => n.type === "thead"),
    headerRows = head ? elements(head.props.children) : [],
    headers = headerRows.length
      ? elements(headerRows[headerRows.length - 1].props.children).map((c) =>
          text(c.props.children)
            .replace(/[↑↓↕]/g, "")
            .replace(/· (Asc\.|Desc\.)/g, "")
            .trim(),
        )
      : [];
  function capture(column: number) {
    const values: Record<string, string> = {};
    for (const body of Array.from(table.current?.tBodies || []))
      for (const row of Array.from(body.rows)) {
        if (row.dataset.sortRow)
          values[row.dataset.sortRow] = row.cells[column]
            ? cellSortText(row.cells[column])
            : "";
      }
    return values;
  }
  function orderedRows(part: Element, partIndex: number, selection = sort) {
    const rows = elements(part.props.children).map((row, index) => ({
      row,
      index,
      key: partIndex + "-" + String(row.key ?? index),
    }));
    if (!selection) return rows;
    // Rows with spanning section/summary cells retain their own positions.
    const normal = rows.filter(
      ({ row }) =>
        row.type === "tr" &&
        !elements(row.props.children).some(
          (cell) => (cell.props.colSpan || 1) > 1,
        ),
    );
    normal.sort(
      (a, b) =>
        compareCells(
          selection.values[a.key],
          selection.values[b.key],
          selection.direction,
        ) || a.index - b.index,
    );
    let next = 0;
    return rows.map((item) =>
      item.row.type === "tr" &&
      !elements(item.row.props.children).some(
        (cell) => (cell.props.colSpan || 1) > 1,
      )
        ? normal[next++]
        : item,
    );
  }
  function order(column: number) {
    const selection = {
      column,
      direction:
        sort?.column === column && sort.direction === "asc"
          ? ("desc" as const)
          : ("asc" as const),
      values: capture(column),
    };
    setSort(selection);
    setMobileColumn(String(column));
    if (onSortRows) {
      const index = parts.findIndex((p) => p.type === "tbody");
      if (index >= 0)
        onSortRows(
          orderedRows(parts[index], index, selection).map((r) => r.index),
        );
    }
  }
  useLayoutEffect(() => {
    if (
      !sort ||
      (table.current?.contains(document.activeElement) &&
        /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || ""))
    )
      return;
    const values = capture(sort.column);
    if (
      Object.keys(values).length !== Object.keys(sort.values).length ||
      Object.entries(values).some(([key, value]) => sort.values[key] !== value)
    ) {
      const selection = { ...sort, values };
      setSort(selection);
      if (onSortRows) {
        const index = parts.findIndex((p) => p.type === "tbody");
        if (index >= 0) {
          const indexes = orderedRows(parts[index], index, selection).map(
            (r) => r.index,
          );
          if (indexes.some((v, i) => v !== i)) onSortRows(indexes);
        }
      }
    }
  });
  const priority = (h: string) =>
    /nombre|producto|materia|material(?!es)/i.test(h)
      ? 0
      : /estado|total|costo calculado/i.test(h)
        ? 1
        : /sku|código|cantidad/i.test(h)
          ? 2
          : /unidad|versión|origen/i.test(h)
            ? 3
            : 6;
  const primary = new Set(
    headers
      .map((h, i) => ({ i, rank: priority(h) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .slice(0, 4)
      .map((x) => x.i),
  );
  return (
    <>
      {headers.length > 0 && (
        <div className="table-mobile-sort">
          <label>
            Ordenar por
            <SearchSelect
              aria-label="Columna para ordenar"
              value={mobileColumn}
              onChange={(e) => {
                setMobileColumn(e.target.value);
                const button =
                  table.current?.tHead?.rows[headerRows.length - 1]?.cells[
                    Number(e.target.value)
                  ]?.querySelector<HTMLButtonElement>("button");
                button?.click();
              }}
            >
              <option value="" disabled>
                Selecciona una columna
              </option>
              {headers.map((label, i) => (
                <option key={i} value={i}>
                  {label || "Columna " + (i + 1)}
                </option>
              ))}
            </SearchSelect>
          </label>
          <AppButton
            type="button"
            iconKey="control.sort"
            className="secondary"
            disabled={mobileColumn === ""}
            onClick={() =>
              table.current?.tHead?.rows[headerRows.length - 1]?.cells[
                Number(mobileColumn)
              ]
                ?.querySelector<HTMLButtonElement>("button")
                ?.click()
            }
          >
            Cambiar sentido
          </AppButton>
        </div>
      )}
      <table
        {...props}
        ref={(node) => {
          table.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        role={props.role || "table"}
        className={"responsive-table " + (className || "")}
        onInvalidCapture={(e) => {
          onInvalidCapture?.(e);
          const row = (e.target as HTMLElement).closest("tr"),
            key = row?.dataset.mobileKey;
          if (key && !expanded.has(key)) {
            e.preventDefault();
            setExpanded((old) => new Set([...old, key]));
            requestAnimationFrame(() => {
              const target = e.target as HTMLInputElement;
              target.focus();
              target.reportValidity?.();
            });
          }
        }}
      >
        {parts.map((part, partIndex) =>
          part.type === "thead"
            ? cloneElement(
                part,
                {},
                elements(part.props.children).map((row, index) =>
                  index !== headerRows.length - 1
                    ? row
                    : cloneElement(
                        row,
                        {},
                        elements(row.props.children).map((cell, column) => {
                          const own = cell.props["aria-sort"] !== undefined;
                          return cloneElement(
                            cell,
                            {
                              "aria-sort":
                                sort?.column === column
                                  ? sort.direction === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : sort
                                    ? "none"
                                    : cell.props["aria-sort"] || "none",
                              onClickCapture: own
                                ? () => {
                                    setSort(null);
                                    setMobileColumn(String(column));
                                  }
                                : undefined,
                            } as {},
                            own ? (
                              cell.props.children
                            ) : (
                              <button
                                type="button"
                                className="table-sort-button"
                                onClick={() => order(column)}
                                aria-label={
                                  "Ordenar por " +
                                  (headers[column] ||
                                    "columna " + (column + 1)) +
                                  ": " +
                                  (sort?.column === column &&
                                  sort.direction === "asc"
                                    ? "descendente"
                                    : "ascendente")
                                }
                              >
                                <AppIcon name="control.sort" />
                                <span>
                                  {cell.props.children}
                                  {sort?.column === column
                                    ? sort.direction === "asc"
                                      ? " · Asc."
                                      : " · Desc."
                                    : ""}
                                </span>
                              </button>
                            ),
                          );
                        }),
                      ),
                ),
              )
            : part.type !== "tbody"
              ? part
              : cloneElement(
                  part,
                  {},
                  (onSortRows
                    ? elements(part.props.children).map((row, index) => ({
                        row,
                        index,
                        key: partIndex + "-" + String(row.key ?? index),
                      }))
                    : orderedRows(part, partIndex)
                  ).map(({ row, index: rowIndex, key }) => {
                    if (row.type !== "tr") return row;
                    const cells = elements(row.props.children),
                      isOpen = expanded.has(key),
                      visible = cells.map(
                        (c, i) =>
                          primary.has(i) ||
                          /acciones/i.test(headers[i] || "") ||
                          editable(c.props.children) ||
                          (c.props.colSpan || 1) > 1,
                      ),
                      extra = visible.some((v) => !v);
                    return cloneElement(
                      row,
                      {
                        "data-mobile-key": key,
                        "data-sort-row": key,
                        "data-expanded": isOpen ? "true" : "false",
                      } as {},
                      <>
                        {cells.map((cell, i) =>
                          cloneElement(
                            cell,
                            {
                              className: [
                                cell.props.className,
                                !visible[i] ? "mobile-extra" : "",
                                /nombre|producto|materia|empaque|insumo|concepto|comentario|descripci[oó]n|acciones/i.test(
                                  headers[i] || "",
                                )
                                  ? "mobile-cell-wide"
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" "),
                            },
                            <>
                              {headers[i] && (
                                <span
                                  className="mobile-cell-label"
                                  aria-hidden="true"
                                >
                                  {headers[i]}
                                </span>
                              )}
                              {cell.props.children}
                            </>,
                          ),
                        )}
                        {extra && (
                          <td
                            className="mobile-row-toggle"
                            colSpan={Math.max(1, cells.length)}
                          >
                            <AppButton
                              type="button"
                              className="secondary"
                              iconKey={
                                isOpen ? "action.collapse" : "action.expand"
                              }
                              aria-expanded={isOpen}
                              aria-label={
                                (isOpen
                                  ? "Menos información"
                                  : "Más información") +
                                " de la fila " +
                                (rowIndex + 1)
                              }
                              onPointerDown={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              onClick={() =>
                                setExpanded((old) => {
                                  const next = new Set(old);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                            >
                              {isOpen ? "Menos información" : "Más información"}
                            </AppButton>
                          </td>
                        )}
                      </>,
                    );
                  }),
                ),
        )}
      </table>
    </>
  );
});
