interface MapSelectionInput {
  storedMapPackId: unknown;
  catalogDefaultMapId: string | undefined;
  bundledMapPackId: string | undefined;
  demoMapPackId: string;
}

export function resolveRequestedMapPackId({
  storedMapPackId,
  catalogDefaultMapId,
  bundledMapPackId,
  demoMapPackId,
}: MapSelectionInput): string {
  const storedId =
    typeof storedMapPackId === "string" ? storedMapPackId : undefined;

  if (storedId === demoMapPackId && catalogDefaultMapId) {
    return catalogDefaultMapId;
  }

  return storedId ?? catalogDefaultMapId ?? bundledMapPackId ?? demoMapPackId;
}
