import { describe, it, expect } from 'vitest'
import { mediaPathExample, detectOs } from './platform'

describe('mediaPathExample', () => {
  it('OS ごとに実態に合ったパス例を返す', () => {
    expect(mediaPathExample('windows')).toBe('D:\\Footage\\Taiwan')
    expect(mediaPathExample('mac')).toBe('/Volumes/Footage/Taiwan')
    expect(mediaPathExample('linux')).toBe('/home/you/footage/Taiwan')
  })
})

describe('detectOs', () => {
  it('navigator.userAgent から OS を判定する', () => {
    const orig = navigator.userAgent
    const set = (ua: string) =>
      Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
    try {
      set('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
      expect(detectOs()).toBe('windows')
      set('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      expect(detectOs()).toBe('mac')
      set('Mozilla/5.0 (X11; Linux x86_64)')
      expect(detectOs()).toBe('linux')
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: orig, configurable: true })
    }
  })
})
