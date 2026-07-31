import type { MapIconName } from "./types";

const ICON_PATHS: Record<MapIconName, string[]> = {
  activity: [
    "M12 3.5 14.6 9l5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1L9.4 9z",
  ],
  boss: [
    "M4 17h16l-1.1-10-4.8 4-2.1-6-2.1 6-4.8-4z",
    "M5 20h14",
  ],
  chest: [
    "M4 8h16v11H4z",
    "m3 0 1-4h8l1 4",
    "M9 12h6v3H9z",
  ],
  collection: [
    "m12 3 7 8-7 10-7-10z",
    "M5 11h14",
    "m9 4-4 7 7 10 7-10-4-7",
  ],
  default: [
    "M4 4h6v6H4z",
    "M14 4h6v6h-6z",
    "M4 14h6v6H4z",
    "M14 14h6v6h-6z",
  ],
  elite: [
    "M12 3 19 6v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6z",
    "m9 11 2 2 4-4",
  ],
  enemy: [
    "M7 8 4 4v6l3 2",
    "m17 8 3-4v6l-3 2",
    "M7 10c0-3 2-5 5-5s5 2 5 5v5c0 3-2 5-5 5s-5-2-5-5z",
    "M9.5 13h.01M14.5 13h.01M10 17h4",
  ],
  exploration: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
    "m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4z",
  ],
  location: [
    "M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11",
    "M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5",
  ],
  resource: [
    "M19 4C11 4 6 8 6 14c0 3 2 5 5 5 6 0 8-7 8-15",
    "M5 20c2-5 5-8 10-11",
  ],
};

export function createFilterIcon(
  icon: MapIconName | undefined,
  fallback: string,
): HTMLSpanElement {
  const wrapper = document.createElement("span");
  wrapper.className = "filter-icon";
  const paths = icon ? ICON_PATHS[icon] : undefined;

  if (!paths) {
    wrapper.textContent = fallback;
    return wrapper;
  }

  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  for (const pathData of paths) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }

  wrapper.append(svg);
  return wrapper;
}
