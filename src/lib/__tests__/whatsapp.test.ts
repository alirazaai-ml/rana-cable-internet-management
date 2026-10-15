import { describe, expect, it } from 'vitest'
import { toWaNumber, waLink } from '../whatsapp'

describe('whatsapp links', () => {
  it('converts to the international number wa.me expects', () => expect(toWaNumber('0300 1234567')).toBe('923001234567'))
  it('throws on invalid numbers instead of opening a wrong chat', () => expect(() => toWaNumber('123')).toThrow())
  it('encodes the message', () => {
    const url = waLink('03001234567', 'Dear Ali,\nRs. 1500 & thanks')
    expect(url.startsWith('https://wa.me/923001234567?text=')).toBe(true)
    expect(url).toContain(encodeURIComponent('Dear Ali,\nRs. 1500 & thanks'))
    expect(url).not.toContain(' ')
  })
})
