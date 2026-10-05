import { describe, expect, it } from 'vitest'
import { closeTab, cycleTab, moveTab, openTab, type Tabs } from '../src/renderer/src/lib/tabs'

const t = (open: string[], active: string | null): Tabs => ({ open, active })

describe('project tabs', () => {
  it('opens a project in a new tab right after the active one', () => {
    expect(openTab(t(['a', 'b'], 'a'), 'c')).toEqual(t(['a', 'c', 'b'], 'c'))
    expect(openTab(t([], null), 'a')).toEqual(t(['a'], 'a'))
    expect(openTab(t(['a'], null), 'b')).toEqual(t(['a', 'b'], 'b')) // from the start screen: at the end
  })
  it('focuses an already open project instead of opening it twice', () => {
    expect(openTab(t(['a', 'b'], 'a'), 'b')).toEqual(t(['a', 'b'], 'b'))
  })
  it('closing the active tab moves to the right neighbour, else the left, else the start screen', () => {
    expect(closeTab(t(['a', 'b', 'c'], 'b'), 'b')).toEqual(t(['a', 'c'], 'c'))
    expect(closeTab(t(['a', 'b'], 'b'), 'b')).toEqual(t(['a'], 'a'))
    expect(closeTab(t(['a'], 'a'), 'a')).toEqual(t([], null))
  })
  it('closing another tab keeps the active one', () => {
    expect(closeTab(t(['a', 'b', 'c'], 'c'), 'a')).toEqual(t(['b', 'c'], 'c'))
  })
  it('cycles with wrap-around', () => {
    expect(cycleTab(t(['a', 'b', 'c'], 'c'), 1).active).toBe('a')
    expect(cycleTab(t(['a', 'b', 'c'], 'a'), -1).active).toBe('c')
    expect(cycleTab(t([], null), 1)).toEqual(t([], null))
  })
  it('reorders by dragging', () => {
    expect(moveTab(t(['a', 'b', 'c'], 'a'), 'a', 2).open).toEqual(['b', 'c', 'a'])
    expect(moveTab(t(['a', 'b', 'c'], 'a'), 'c', 0).open).toEqual(['c', 'a', 'b'])
  })
})
