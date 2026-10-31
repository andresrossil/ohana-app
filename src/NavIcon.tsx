import { AppIcon } from "./AppIcon";
export default function NavIcon({ name }: { name: string }) {
  return <AppIcon name={"module." + name} />;
}
