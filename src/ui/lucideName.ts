/** `ShoppingCart` → `shopping-cart`, `Grid2x2Check` → `grid-2x2-check`, as the host spells it. */
export function toLucideName(componentName: string): string {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/(?<![0-9])([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}
