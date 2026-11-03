import { useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";
export default function AutoTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const e = ref.current;
    if (e) {
      e.style.height = "auto";
      e.style.height = e.scrollHeight + "px";
    }
  };
  useLayoutEffect(resize, [props.value, props.defaultValue]);
  return (
    <textarea
      {...props}
      ref={ref}
      rows={props.rows || 2}
      style={{
        ...props.style,
        overflow: "hidden",
        resize: "none",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
      onInput={(e) => {
        resize();
        props.onInput?.(e);
      }}
    />
  );
}
