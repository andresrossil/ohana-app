import { useState } from "react";
import type { InputHTMLAttributes } from "react";
export default function DecimalInput({
  value,
  onFocus,
  onBlur,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  const n = value === "" || value == null ? null : Number(value);
  const shown =
    !focused && n !== null && Number.isFinite(n)
      ? String(Number(n.toFixed(2)))
      : value;
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={shown}
      data-precision-value={value ?? ""}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}
