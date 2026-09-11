export const IMAGE_ZOOM_MIN = 1;
export const IMAGE_ZOOM_MAX = 3;
export const IMAGE_ZOOM_STEP = 0.25;

export function clampImageZoom(zoom: number): number {
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, zoom));
}

export function adjustImageZoom(zoom: number, direction: 1 | -1): number {
  return clampImageZoom(zoom + direction * IMAGE_ZOOM_STEP);
}
