import { lazy, Suspense, Component } from "react";
import type { ReactNode } from "react";
import imports from "lucide-react/dynamicIconImports";
import { Circle } from "lucide-react";
const cache = new Map<string, ReturnType<typeof lazy>>();
class IconBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Circle aria-hidden="true" size={18} />
    ) : (
      this.props.children
    );
  }
}
export default function LucideDynamic({ name }: { name: string }) {
  const loader = imports[name as keyof typeof imports];
  if (!loader) return <Circle aria-hidden="true" size={18} />;
  if (!cache.has(name)) cache.set(name, lazy(loader));
  const Icon = cache.get(name)!;
  return (
    <IconBoundary key={name}>
      <Suspense fallback={<span className="icon-placeholder" />}>
        <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      </Suspense>
    </IconBoundary>
  );
}
