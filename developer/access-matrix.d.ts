export type AccessCatalogSurface = 'model' | 'host';
export interface AccessCatalogCase<C> {
  name: string;
  /** Trusted fixture/authentication context; never returned in diagnostics. */
  context: C;
  /** Explicit expected names for every surface used by the configured entrances. */
  expected: Partial<Record<AccessCatalogSurface, readonly string[]>>;
}
export interface AccessCatalogEntrance<C> {
  name: string;
  surface: AccessCatalogSurface;
  /** Read-only authenticated catalog adapter. No business execution probes. */
  list(context: C): readonly string[] | Promise<readonly string[]>;
}
export interface AccessCatalogCheck {
  case: string; entrance: string; surface: AccessCatalogSurface; passed: boolean;
  missing: string[]; unexpected: string[];
  error?: 'CATALOG_UNAVAILABLE' | 'INVALID_CATALOG';
}
export function checkAccessCatalogMatrix<C>(options: {
  cases: readonly AccessCatalogCase<C>[];
  entrances: readonly AccessCatalogEntrance<C>[];
}): Promise<{passed: boolean; checks: AccessCatalogCheck[]}>;
