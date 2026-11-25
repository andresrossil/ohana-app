import { DISCLOSURE_INITIALLY_OPEN } from "./disclosure-default";
import TableActions from "./TableActions";
import {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
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
  "data-mobile-visible"?: boolean;
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
function isActionButton(node: ReactNode) {
  return isValidElement(node) && (node.type === AppButton || node.type === "button");
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
    showAllMobileFields?: boolean;
    compactRowActions?: boolean;
    mobileTable?: boolean;
    sortable?: boolean;
    onSortRows?: (indexes: number[]) => void;
  }
>(function ResponsiveTable(
  { children, className, onInvalidCapture, onSortRows, showAllMobileFields, compactRowActions, mobileTable, sortable = true, ...props },
  ref,
) {
  const [overrides, setOverrides] = useState<Set<string>>(new Set()),
    parts = elements(children);
  const isExpanded = (key: string) => overrides.has(key) ? !DISCLOSURE_INITIALLY_OPEN : DISCLOSURE_INITIALLY_OPEN;
  const table = useRef<HTMLTableElement | null>(null);
  const [sort, setSort] = useState<{
    column: number;
    direction: "asc" | "desc";
    values: Record<string, string>;
  } | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [descriptionSort, setDescriptionSort] = useState<typeof sort>(null);
  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(viewport.matches);
    viewport.addEventListener("change", update);
    update();
    return () => viewport.removeEventListener("change", update);
  }, []);
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
  const descriptionColumn = headers.findIndex((heading) => /^descripci[oó]n\b/i.test(heading));
  const mobileColumn = descriptionColumn >= 0 ? descriptionColumn : headers.findIndex((heading) =>
    /^(nombre|producto|materia prima|material|ingrediente|art[ií]culo|cliente|proveedor|concepto|fondo|variante)\b/i.test(heading),
  );
  const selection = mobile && !mobileTable && sortable && mobileColumn >= 0 ? descriptionSort : sort;
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
  function orderedRows(part: Element, partIndex: number, orderBy = selection) {
    const rows = elements(part.props.children).map((row, index) => ({
      row,
      index,
      key: partIndex + "-" + String(row.key ?? index),
    }));
    if (!orderBy) return rows;
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
          orderBy.values[a.key],
          orderBy.values[b.key],
          orderBy.direction,
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
    if (onSortRows) {
      const index = parts.findIndex((p) => p.type === "tbody");
      if (index >= 0)
        onSortRows(
          orderedRows(parts[index], index, selection).map((r) => r.index),
        );
    }
  }
  useLayoutEffect(() => {
    if (!mobile || mobileTable || !sortable || mobileColumn < 0 ||
      (table.current?.contains(document.activeElement) &&
        /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || ""))) return;
    const values = capture(mobileColumn);
    const next = { column: mobileColumn, direction: "asc" as const, values };
    if (descriptionSort?.column !== mobileColumn ||
      Object.keys(values).length !== Object.keys(descriptionSort.values).length ||
      Object.entries(values).some(([key, value]) => descriptionSort.values[key] !== value)) {
      setDescriptionSort(next);
    }
    const body = parts.findIndex((part) => part.type === "tbody");
    if (onSortRows && body >= 0) {
      const indexes = orderedRows(parts[body], body, next).map((row) => row.index);
      if (indexes.some((value, index) => value !== index)) onSortRows(indexes);
    }
  });
  useLayoutEffect(() => {
    if (
      (mobile && !mobileTable) || !sort ||
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
    /nombre|producto|materia|material(?!es)|^fondo$|^artículo|^cliente|^proveedor|^concepto/i.test(h)
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
      .slice(0, 3)
      .map((x) => x.i),
  );
  return (
    <>
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
          if (key && !isExpanded(key)) {
            e.preventDefault();
            setOverrides((old) => {
              const next = new Set(old);
              if (DISCLOSURE_INITIALLY_OPEN) next.delete(key);
              else next.add(key);
              return next;
            });
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
            ? !sortable ? part : cloneElement(
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
                      isOpen = isExpanded(key),
                      visible = cells.map(
                        (c, i) =>
                          showAllMobileFields || c.props["data-mobile-visible"] || primary.has(i) ||
                          /acciones/i.test(headers[i] || "") ||
                          editable(c.props.children) ||
                          (c.props.colSpan || 1) > 1,
                      ),
                      extra = visible.some((v) => !v);
                    const toggleLabel = isOpen ? "Menos información" : "Más información";
                    const toggle = extra && (
                      <AppButton
                        type="button"
                        className={compactRowActions ? "secondary catalog-icon-button" : "secondary"}
                        iconKey={isOpen ? "action.collapse" : "action.expand"}
                        aria-expanded={isOpen}
                        aria-label={toggleLabel + " de la fila " + (rowIndex + 1)}
                        title={compactRowActions ? toggleLabel : undefined}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onClick={() =>
                          setOverrides((old) => {
                            const next = new Set(old);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      >
                        {!compactRowActions && toggleLabel}
                      </AppButton>
                    );
                    return cloneElement(
                      row,
                      {
                        "data-mobile-key": key,
                        "data-sort-row": key,
                        "data-expanded": isOpen ? "true" : "false",
                      } as {},
                      <>
                        {cells.map((cell, i) => {
                          const header = headers[i] || "";
                          const actions = /acciones/i.test(header);
                          const content = Children.toArray(cell.props.children);
                          const firstButton = actions ? content.findIndex(isActionButton) : -1;
                          const afterButtons = firstButton < 0 ? -1 :
                            content.findIndex((node, index) => index > firstButton && !isActionButton(node));
                          const end = afterButtons < 0 ? content.length : afterButtons;
                          const actionContent = !compactRowActions && firstButton >= 0 && end - firstButton > 2 ? <>
                            {content.slice(0, firstButton)}
                            <TableActions primary={content[firstButton]} secondary={content.slice(firstButton + 1, end)} />
                            {content.slice(end)}
                          </> : cell.props.children;
                          return cloneElement(
                            cell,
                            {
                              className: [
                                cell.props.className,
                                !visible[i] ? "mobile-extra" : "",
                                actions ? "mobile-actions-cell" : "",
                                (priority(header) === 0 && !editable(cell.props.children)) ? "mobile-record-title" : "",
                                (cell.props.colSpan || 1) > 1 ? "mobile-cell-wide" : "",
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
                                >
                                  {headers[i]}
                                </span>
                              )}
                              {actionContent}
                              {compactRowActions && actions && toggle}
                            </>,
                          );
                        })}
                        {!compactRowActions && toggle && (
                          <td className="mobile-row-toggle" colSpan={Math.max(1, cells.length)}>
                            {toggle}
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
