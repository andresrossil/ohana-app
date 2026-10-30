declare module "jsbarcode" {
  const JsBarcode: (
    element: SVGSVGElement | string,
    value: string,
    options?: Record<string, unknown>,
  ) => void;
  export default JsBarcode;
}
