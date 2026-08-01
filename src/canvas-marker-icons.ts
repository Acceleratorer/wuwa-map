import L, {
  type CircleMarker,
  type CircleMarkerOptions,
  type LatLngExpression,
} from "leaflet";

interface CanvasMarkerVisual {
  done: boolean;
  image?: HTMLImageElement;
  symbol: string;
}

interface CanvasIconCircleOptions extends CircleMarkerOptions {
  wayfinderIcon?: CanvasMarkerVisual;
}

interface CanvasCircleInternals extends CircleMarker {
  _empty(): boolean;
  _point: L.Point;
  _radius: number;
  options: CanvasIconCircleOptions;
}

interface CanvasRendererInternals extends L.Canvas {
  _ctx: CanvasRenderingContext2D;
  _drawing: boolean;
  _redraw(): void;
  _updateCircle(layer: CanvasCircleInternals): void;
}

const imageCache = new Map<string, HTMLImageElement>();
let activeRenderer: CanvasRendererInternals | undefined;
let redrawFrame: number | undefined;
let rendererInstalled = false;

function scheduleRendererRedraw(): void {
  if (!activeRenderer || redrawFrame !== undefined) {
    return;
  }
  redrawFrame = window.requestAnimationFrame(() => {
    redrawFrame = undefined;
    activeRenderer?._redraw();
  });
}

function resolveIconImage(source: string | undefined): HTMLImageElement | undefined {
  if (!source) {
    return undefined;
  }
  const cached = imageCache.get(source);
  if (cached) {
    return cached;
  }

  const image = new Image();
  image.alt = "";
  image.decoding = "async";
  image.addEventListener("load", scheduleRendererRedraw, { once: true });
  image.addEventListener("error", scheduleRendererRedraw, { once: true });
  image.src = source;
  imageCache.set(source, image);
  return image;
}

function drawCanvasMarkerIcon(
  renderer: CanvasRendererInternals,
  layer: CanvasCircleInternals,
  visual: CanvasMarkerVisual,
): void {
  const context = renderer._ctx;
  const point = layer._point;
  const radius = Math.max(Math.round(layer._radius), 1);
  const iconSize = Math.max(12, Math.round(radius * 1.5));

  context.save();
  context.globalAlpha = visual.done ? 0.52 : 1;
  context.beginPath();
  context.arc(point.x, point.y, Math.max(radius - 2, 1), 0, Math.PI * 2);
  context.clip();

  if (visual.image?.complete && visual.image.naturalWidth > 0) {
    context.drawImage(
      visual.image,
      point.x - iconSize / 2,
      point.y - iconSize / 2,
      iconSize,
      iconSize,
    );
  } else {
    context.fillStyle = "#effffb";
    context.font = `800 ${Math.max(8, radius)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(visual.symbol.slice(0, 2), point.x, point.y + 0.5);
  }
  context.restore();

  if (!visual.done) {
    return;
  }

  const badgeRadius = Math.max(3.5, radius * 0.38);
  const badgeX = point.x + radius * 0.7;
  const badgeY = point.y + radius * 0.7;
  context.save();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
  context.fillStyle = "#72f7b2";
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = "#e8fffa";
  context.stroke();
  context.fillStyle = "#06211d";
  context.font = `900 ${Math.max(6, badgeRadius * 1.45)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("✓", badgeX, badgeY + 0.4);
  context.restore();
}

function installCanvasIconRenderer(): void {
  if (rendererInstalled) {
    return;
  }
  rendererInstalled = true;

  // Leaflet 1.9 calls this private renderer hook for every CircleMarker.
  // The dependency is pinned, and markers without wayfinderIcon keep the
  // original renderer behavior unchanged.
  const prototype = L.Canvas.prototype as unknown as CanvasRendererInternals;
  const updateCircle = prototype._updateCircle;
  prototype._updateCircle = function (layer: CanvasCircleInternals): void {
    updateCircle.call(this, layer);
    const visual = layer.options.wayfinderIcon;
    if (!visual || !this._drawing || layer._empty()) {
      return;
    }
    activeRenderer = this;
    drawCanvasMarkerIcon(this, layer, visual);
  };
}

export function createCanvasIconMarker(
  latLng: LatLngExpression,
  options: CircleMarkerOptions,
  imageSource: string | undefined,
  symbol: string,
  done: boolean,
): CircleMarker {
  installCanvasIconRenderer();
  const markerOptions: CanvasIconCircleOptions = {
    ...options,
    wayfinderIcon: {
      done,
      image: resolveIconImage(imageSource),
      symbol,
    },
  };
  return L.circleMarker(latLng, markerOptions);
}
