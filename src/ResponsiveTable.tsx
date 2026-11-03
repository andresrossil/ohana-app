import {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useState,
} from "react";
import type { ReactElement, ReactNode, TableHTMLAttributes } from "react";
import { AppButton } from "./AppIcon";
type Element = ReactElement<{
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  readOnly?: boolean;
  onChange?: unknown;
  type?: string;
  scope?: string;
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
  TableHTMLAttributes<HTMLTableElement>
>(function ResponsiveTable(
  { children, className, onInvalidCapture, ...props },
  ref,
) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set()),
    parts = elements(children);
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
    <table
      {...props}
      ref={ref}
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
        part.type !== "tbody"
          ? part
          : cloneElement(
              part,
              {},
              elements(part.props.children).map((row, rowIndex) => {
                if (row.type !== "tr") return row;
                const cells = elements(row.props.children),
                  key = partIndex + "-" + String(row.key ?? rowIndex),
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
                            /nombre|producto|materia|comentario|descripci[oó]n|acciones/i.test(
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
                          iconKey={isOpen ? "action.collapse" : "action.expand"}
                          aria-expanded={isOpen}
                          aria-label={
                            (isOpen ? "Menos información" : "Más información") +
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
  );
});

