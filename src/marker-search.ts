export interface MarkerSearchRecord {
  id: string;
  title: string;
  categoryId: string;
  description?: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMarkerSearchIndex(
  markers: readonly MarkerSearchRecord[],
): Map<string, string> {
  return new Map(
    markers.map((marker) => [
      marker.id,
      normalizeSearchText(
        [marker.id, marker.title, marker.categoryId, marker.description]
          .filter(Boolean)
          .join(" "),
      ),
    ]),
  );
}
