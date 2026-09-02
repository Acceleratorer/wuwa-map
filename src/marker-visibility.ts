import type { MapMarker } from "./types";

interface MarkerVisibilityOptions {
  activeFloorId: string;
  completedMarkerIds: ReadonlySet<string>;
  hideCompleted: boolean;
  normalizedSearchTerm: string;
  searchIndex: ReadonlyMap<string, string> | undefined;
  visibleCategoryIds: ReadonlySet<string>;
}

export function filterVisibleMarkers(
  markers: readonly MapMarker[],
  {
    activeFloorId,
    completedMarkerIds,
    hideCompleted,
    normalizedSearchTerm,
    searchIndex,
    visibleCategoryIds,
  }: MarkerVisibilityOptions,
): MapMarker[] {
  return markers.filter((marker) => {
    const isDone = completedMarkerIds.has(marker.id);
    const matchesCategory =
      normalizedSearchTerm.length > 0 ||
      visibleCategoryIds.has(marker.categoryId);
    const matchesSearch =
      normalizedSearchTerm.length === 0 ||
      (searchIndex?.get(marker.id) ?? "").includes(normalizedSearchTerm);
    const matchesFloor =
      activeFloorId === "" || marker.levelId === activeFloorId;

    return (
      matchesCategory &&
      matchesSearch &&
      matchesFloor &&
      !(hideCompleted && isDone)
    );
  });
}
