interface ProgressMarker {
  id: string;
  categoryId: string;
}

export interface ProgressSummary {
  completed: number;
  total: number;
  percentage: number;
}

export function summarizeProgressForCategories(
  markers: readonly ProgressMarker[],
  completedMarkerIds: ReadonlySet<string>,
  selectedCategoryIds: ReadonlySet<string>,
): ProgressSummary {
  let completed = 0;
  let total = 0;

  for (const marker of markers) {
    if (!selectedCategoryIds.has(marker.categoryId)) {
      continue;
    }
    total += 1;
    if (completedMarkerIds.has(marker.id)) {
      completed += 1;
    }
  }

  return {
    completed,
    total,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}
