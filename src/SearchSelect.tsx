import React, {
  Children,
  isValidElement,
  useId,
  useRef,
  useState,
} from "react";
import "./SearchSelect.css";

const alphabet = new Intl.Collator("es", {
  sensitivity: "base",
  numeric: true,
});
function label(node: React.ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: React.ReactNode }>(child)
        ? label(child.props.children)
        : String(child ?? ""),
    )
    .join("");
}
function options(
  children: React.ReactNode,
  includeGroups = true,
): React.ReactElement<any>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<any>(child)) return [];
    if (child.type === "option") return [child];
    const props = child.props as any;
    const nested = options(props.children, includeGroups);
    return child.type === "optgroup"
      ? nested.map((option) =>
          React.cloneElement(option, {
            disabled: props.disabled || option.props.disabled,
            children: includeGroups
              ? props.label + " · " + label(option.props.children)
              : option.props.children,
            "data-option-group": props.label,
          }),
        )
      : nested;
  });
}
function name(text: string) {
  return text.replace(/^[MEPF]\d+(?:-\d+)?\s*[·—-]\s*/i, "");
}
export function SortedDatalist({
  children,
  ...props
}: React.HTMLAttributes<HTMLDataListElement>) {
  return (
    <datalist {...props}>
      {options(children).sort((a, b) =>
        alphabet.compare(
          name(label(a.props.children) || String(a.props.value)),
          name(label(b.props.children) || String(b.props.value)),
        ),
      )}
    </datalist>
  );
}

/** Searchable UI backed by the original select, retaining IDs, FormData and change handlers. */
export default function SearchSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & {
    hideGroupLabels?: boolean;
  },
) {
  const {
    children,
    hideGroupLabels = false,
    value,
    defaultValue,
    onChange,
    required,
    disabled,
    className,
    style,
    name: fieldName,
    ...rest
  } = props;
  const entries = options(children, !hideGroupLabels).map((option) => ({
    value: String(option.props.value ?? label(option.props.children)),
    text: label(option.props.children),
    group: option.props["data-option-group"],
    disabled: !!option.props.disabled,
  }));
  const initial = String(defaultValue ?? entries[0]?.value ?? "");
  entries.sort((a, b) =>
    !a.value ? -1 : !b.value ? 1 : alphabet.compare(name(a.text), name(b.text)),
  );
  const [local, setLocal] = useState(initial);
  const selected = String(
    value ??
      (entries.some((entry) => entry.value === local)
        ? local
        : (entries.find((entry) => !entry.disabled)?.value ?? "")),
  );
  const current = entries.find((entry) => entry.value === selected);
  const [editing, setEditing] = useState<{
    value: string;
    text: string;
  } | null>(null);
  const select = useRef<HTMLSelectElement>(null);
  const id = useId();
  const display = (entry: (typeof entries)[number]) =>
    entries.filter((other) => other.text === entry.text).length > 1
      ? `${entry.text} · ${entry.group || entry.value}`
      : entry.text;
  const text =
    editing?.value === selected
      ? editing.text
      : current?.value
        ? hideGroupLabels
          ? current.text
          : display(current)
        : "";
  function choose(next: string) {
    setLocal(next);
    if (select.current) {
      select.current.value = next;
      onChange?.({
        target: select.current,
        currentTarget: select.current,
      } as React.ChangeEvent<HTMLSelectElement>);
    }
  }
  return (
    <span className="search-select" style={style}>
      <input
        {...(rest as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
        data-search-select="true"
        className={className}
        aria-label={props["aria-label"]}
        aria-describedby={props["aria-describedby"]}
        disabled={disabled}
        required={required}
        list={id}
        autoComplete="off"
        value={text}
        placeholder={
          entries.find((entry) => !entry.value)?.text || "Escribe para buscar…"
        }
        onFocus={(event) => {
          event.currentTarget.select();
          props.onFocus?.(
            event as unknown as React.FocusEvent<HTMLSelectElement>,
          );
        }}
        onChange={(event) => {
          const next = event.target.value;
          const match = entries.find(
            (entry) =>
              !entry.disabled && entry.value && display(entry) === next,
          );
          if (
            match ||
            (!next && entries.some((entry) => !entry.value && !entry.disabled))
          ) {
            event.target.setCustomValidity("");
            choose(match?.value ?? "");
            setEditing(null);
          } else {
            setEditing({ value: selected, text: next });
            event.target.setCustomValidity(
              "Selecciona una opción de la lista.",
            );
          }
        }}
        onBlur={(event) => {
          props.onBlur?.(
            event as unknown as React.FocusEvent<HTMLSelectElement>,
          );
        }}
      />
      <select
        name={fieldName}
        ref={select}
        disabled={disabled}
        value={selected}
        onChange={onChange ?? (() => {})}
        className="search-select-native"
        tabIndex={-1}
        aria-hidden="true"
      >
        {entries.map((entry) => (
          <option
            key={entry.value}
            value={entry.value}
            disabled={entry.disabled}
          >
            {entry.text}
          </option>
        ))}
      </select>
      <datalist id={id}>
        {entries
          .filter((entry) => entry.value && !entry.disabled)
          .map((entry) => (
            <option key={entry.value} value={display(entry)} />
          ))}
      </datalist>
    </span>
  );
}
