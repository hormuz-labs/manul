// The live mix: the player's own sound and the music go through Web Audio, with the same gains the render uses
// (shared/mix.ts previewGains), so moving a slider is heard at once and Apply renders exactly that.
import { useEffect, useRef } from 'react'
import { duckEnvelope, previewGains, type Mix, type Region } from '../../../shared/mix'
import { mediaUrl } from './utils'

type Graph = { ctx: AudioContext; film: GainNode; music: GainNode; audio: HTMLAudioElement }
const graphs = new WeakMap<HTMLVideoElement, Graph>()

function graphFor(video: HTMLVideoElement): Graph {
  let g = graphs.get(video)
  if (g) return g
  const ctx = new AudioContext()
  const film = ctx.createGain()
  ctx.createMediaElementSource(video).connect(film).connect(ctx.destination)
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.loop = true
  const music = ctx.createGain()
  music.gain.value = 0
  ctx.createMediaElementSource(audio).connect(music).connect(ctx.destination)
  g = { ctx, film, music, audio }
  graphs.set(video, g)
  return g
}

export function useLiveMix(video: HTMLVideoElement | null, dir: string, mix: Mix, regions: Region[]) {
  const live = useRef({ mix, regions })
  live.current = { mix, regions }
  useEffect(() => {
    if (!video) return
    const g = graphFor(video)
    let raf = 0
    const sync = () => {
      const d = g.audio.duration
      if (d > 0 && Math.abs(g.audio.currentTime - (video.currentTime % d)) > 0.12) g.audio.currentTime = video.currentTime % d
    }
    const tick = () => {
      const { mix: m, regions: r } = live.current
      const gains = previewGains(video.currentTime, video.duration || 0, m, duckEnvelope(r, m.music?.duckDb || 0))
      ;(window as unknown as { __manulLiveMix?: object }).__manulLiveMix = { t: video.currentTime, ...gains, musicPlaying: !g.audio.paused } // for tests and debugging
      g.film.gain.setTargetAtTime(gains.film, g.ctx.currentTime, 0.02)
      g.music.gain.setTargetAtTime(gains.music, g.ctx.currentTime, 0.02)
      if (!video.paused) sync()
      raf = requestAnimationFrame(tick)
    }
    const play = () => { g.ctx.resume(); if (live.current.mix.music) { sync(); g.audio.play().catch(() => {}) } }
    const pause = () => g.audio.pause()
    video.addEventListener('play', play)
    video.addEventListener('pause', pause)
    video.addEventListener('seeked', sync)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); video.removeEventListener('play', play); video.removeEventListener('pause', pause); video.removeEventListener('seeked', sync); g.audio.pause() }
  }, [video])
  // the music file
  useEffect(() => {
    if (!video) return
    const g = graphFor(video)
    const src = mix.music ? mediaUrl(`${dir}/${mix.music.src}`) : ''
    if (g.audio.src !== src) { g.audio.src = src; if (src && !video.paused) g.audio.play().catch(() => {}) }
    if (!src) g.audio.pause()
  }, [video, dir, mix.music?.src])
}
