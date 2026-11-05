export type MaterialType = {
  id?: string;
  key: string;
  name: string;
  prefix: string;
  revision?: number;
};
export const defaultMaterialTypes: MaterialType[] = [
  { key: "Materia prima", name: "Materia prima", prefix: "M" },
  { key: "Material de empaque", name: "Material de empaque", prefix: "E" },
  { key: "Insumos", name: "Insumos", prefix: "M" },
];
const normalize = (s: string) => s.trim().toLocaleLowerCase();
export function materialTypeKey(text: string, types: MaterialType[]) {
  return (
    types.find((t) => normalize(t.name) === normalize(text))?.key ??
    types.find((t) => t.key === text)?.key ?? text
  );
}
export function materialTypeName(
  key: string | null | undefined,
  types: MaterialType[],
) {
  return types.find((t) => t.key === key)?.name ?? key ?? "";
}
