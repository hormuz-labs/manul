// Thumbnails become denser with zoom, stopping at one tile per source frame.
export const thumbnailWidth = (viewportWidth: number) => Math.max(112, viewportWidth / 20)
export const sourceFrames = (duration: number, fps: number) => Math.max(1, Math.ceil(duration * fps - 1e-6))
export const thumbnailCount = (width: number, viewportWidth: number, duration: number, fps: number) =>
  Math.min(sourceFrames(duration, fps), Math.max(4, Math.ceil(width / thumbnailWidth(viewportWidth))))
export const frameZoom = (viewportWidth: number, duration: number, fps: number) =>
  Math.max(1, sourceFrames(duration, fps) * thumbnailWidth(viewportWidth) / Math.max(1, viewportWidth))
