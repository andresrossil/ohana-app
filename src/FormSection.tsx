import { DISCLOSURE_INITIALLY_OPEN } from "./disclosure-default";
import type { ReactNode } from "react";
import { AppIcon } from "./AppIcon";

export default function FormSection({ title, icon, initiallyOpen = DISCLOSURE_INITIALLY_OPEN, children }: {
  title: string;
  icon: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return <details className="compact-form-section" open={initiallyOpen}>
    <summary>
      <AppIcon name={icon} />
      <span>{title}</span>
      <span className="compact-form-chevron"><AppIcon name="action.expand" /></span>
    </summary>
    <div className="compact-form-section-content">{children}</div>
  </details>;
}
