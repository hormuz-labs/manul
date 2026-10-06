import { expect, it } from 'vitest'
import { frameZoom, sourceFrames, thumbnailCount } from '../src/renderer/src/lib/timelineScale'

it('reveals all 60 source frames per second at full zoom without duplicating frames', () => {
  for (const width of [320, 738, 2560]) {
    const max = frameZoom(width, 4, 60)
    const fit = thumbnailCount(width, width, 4, 60)
    expect(thumbnailCount(width * 2, width, 4, 60)).toBeGreaterThan(fit)
    expect(thumbnailCount(width * max, width, 4, 60)).toBe(240)
    expect(thumbnailCount(width * max * 2, width, 4, 60)).toBe(240)
  }
})

it('uses the source rate for fractional fps and long videos', () => {
  expect(sourceFrames(10, 29.97)).toBe(300)
  const width = 738, duration = 3600, fps = 24
  const zoom = frameZoom(width, duration, fps)
  expect(thumbnailCount(width * zoom, width, duration, fps)).toBe(86400)
  expect(thumbnailCount(width, width, 1 / 60, 60)).toBe(1)
})
