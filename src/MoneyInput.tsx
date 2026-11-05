import { parseNumber } from "./sheet-model.ts";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import "./MoneyInput.css";
export default function MoneyInput({
  value,
  defaultValue,
  name,
  currency = "GTQ",
  onChange,
  onFocus,
  onBlur,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { currency?: string }) {
  const [local, setLocal] = useState(String(defaultValue ?? "")),
    [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null),
    raw = String(value ?? local);
  const n = parseNumber(raw),
    valid = n != null && Number.isFinite(n);
  function editable(text: string) {
    let s = text.replace(/^(?:GTQ|USD|MXN|EUR|Q|\$|€)\s*/i, "").trim();
    if (/^-?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return s.replace(/,/g, "");
    return /^-?\d+,\d{0,8}$/.test(s) ? s.replace(",", ".") : s;
  }
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "GTQ";
  const shown =
    !focused && valid
      ? new Intl.NumberFormat("es-GT", {
          style: "currency",
          currency: code,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(n)
      : editable(raw);
  useEffect(() => {
    const lo = props.min == null ? null : Number(props.min),
      hi = props.max == null ? null : Number(props.max);
    ref.current?.setCustomValidity(
      raw !== "" &&
        (!valid || (lo != null && n! < lo) || (hi != null && n! > hi))
        ? "Ingresa un importe válido dentro del rango permitido."
        : "",
    );
  }, [raw, props.min, props.max]);
  return (
    <span className="money-input">
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={shown}
        data-precision-value={editable(raw)}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onChange={(e) => {
          const next = editable(e.target.value);
          e.target.value = next;
          setLocal(next);
          onChange?.(e);
        }}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={editable(raw)}
          disabled={props.disabled}
        />
      )}
    </span>
  );
}
