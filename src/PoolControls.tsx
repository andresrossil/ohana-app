import { DISCLOSURE_INITIALLY_OPEN } from "./disclosure-default";
import { Children, cloneElement, isValidElement, useState } from "react";
import type {
  DetailsHTMLAttributes,
  ComponentPropsWithRef,
  ReactNode,
} from "react";
import { AppIcon } from "./AppIcon";
export function IconDetails({
  children,
  onToggle,
  open: requestedOpen = DISCLOSURE_INITIALLY_OPEN,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const [open, setOpen] = useState(requestedOpen);
  return (
    <details
      {...props}
      open={requestedOpen}
      className={"pool-details " + (props.className || "")}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        onToggle?.(e);
      }}
    >
      {Children.map(children, (n) =>
        isValidElement<{ children?: ReactNode }>(n) && n.type === "summary"
          ? cloneElement(
              n,
              {},
              <>
                <AppIcon name={open ? "action.collapse" : "action.expand"} />
                {n.props.children}
              </>,
            )
          : n,
      )}
    </details>
  );
}
export function SearchField(props: ComponentPropsWithRef<"input">) {
  return (
    <span className="pool-search-field">
      <AppIcon name="action.search" />
      <input {...props} type={props.type || "search"} />
    </span>
  );
}
