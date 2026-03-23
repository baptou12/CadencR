import { describe, it, expect } from 'vitest'
import { parseAnsi } from './ansi-to-html'

// Helper to extract text content from React nodes
function extractText(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || node === undefined) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && node !== null && 'props' in (node as object)) {
    const el = node as { props: { children?: unknown } }
    return extractText(el.props.children)
  }
  return String(node)
}

// Helper to get style from a React span element
function getStyle(node: unknown): Record<string, unknown> {
  if (typeof node === 'object' && node !== null && 'props' in (node as object)) {
    const el = node as { props: { style?: Record<string, unknown> } }
    return el.props.style ?? {}
  }
  return {}
}

describe('parseAnsi', () => {
  it('passes through plain text with no ANSI codes', () => {
    const result = parseAnsi('hello world')
    expect(extractText(result)).toBe('hello world')
  })

  it('returns empty string for empty input', () => {
    const result = parseAnsi('')
    expect(result).toBe('')
  })

  it('renders green foreground color', () => {
    // ESC[32m = green fg
    const result = parseAnsi('\x1b[32mSuccess\x1b[0m')
    const text = extractText(result)
    expect(text).toBe('Success')
    // The green span should have color set
    const nodes = Array.isArray(result) ? result : [result]
    const greenSpan = nodes.find(n => {
      const s = getStyle(n)
      return s.color === '#50fa7b'
    })
    expect(greenSpan).toBeTruthy()
  })

  it('renders red foreground color', () => {
    // ESC[31m = red fg
    const result = parseAnsi('\x1b[31mError\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const redSpan = nodes.find(n => getStyle(n).color === '#ff5555')
    expect(redSpan).toBeTruthy()
    expect(extractText(result)).toBe('Error')
  })

  it('renders yellow foreground color', () => {
    const result = parseAnsi('\x1b[33mWarning\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).color === '#f1fa8c')
    expect(span).toBeTruthy()
  })

  it('renders cyan foreground color', () => {
    const result = parseAnsi('\x1b[36mInfo\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).color === '#8be9fd')
    expect(span).toBeTruthy()
  })

  it('renders background colors', () => {
    // ESC[42m = green bg
    const result = parseAnsi('\x1b[42mBG Green\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).backgroundColor === '#50fa7b')
    expect(span).toBeTruthy()
    expect(extractText(result)).toBe('BG Green')
  })

  it('renders bold text', () => {
    // ESC[1m = bold
    const result = parseAnsi('\x1b[1mBold\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).fontWeight === 'bold')
    expect(span).toBeTruthy()
    expect(extractText(result)).toBe('Bold')
  })

  it('renders dim text', () => {
    // ESC[2m = dim
    const result = parseAnsi('\x1b[2mDim\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).opacity === 0.6)
    expect(span).toBeTruthy()
  })

  it('renders italic text', () => {
    // ESC[3m = italic
    const result = parseAnsi('\x1b[3mItalic\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).fontStyle === 'italic')
    expect(span).toBeTruthy()
  })

  it('renders underline text', () => {
    // ESC[4m = underline
    const result = parseAnsi('\x1b[4mUnderline\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).textDecoration === 'underline')
    expect(span).toBeTruthy()
  })

  it('renders bold + color (nested styles)', () => {
    // ESC[1;32m = bold + green
    const result = parseAnsi('\x1b[1;32mBold Green\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => {
      const s = getStyle(n)
      return s.fontWeight === 'bold' && s.color === '#50fa7b'
    })
    expect(span).toBeTruthy()
    expect(extractText(result)).toBe('Bold Green')
  })

  it('handles reset sequences correctly', () => {
    const result = parseAnsi('\x1b[32mGreen\x1b[0m Normal')
    const text = extractText(result)
    expect(text).toBe('Green Normal')
  })

  it('handles bright colors (90-97)', () => {
    // ESC[92m = bright green
    const result = parseAnsi('\x1b[92mBright Green\x1b[0m')
    const nodes = Array.isArray(result) ? result : [result]
    const span = nodes.find(n => getStyle(n).color === '#69ff94')
    expect(span).toBeTruthy()
  })

  it('handles text with no ANSI codes as passthrough', () => {
    const plain = 'No escape codes here: just text'
    const result = parseAnsi(plain)
    expect(extractText(result)).toBe(plain)
  })

  it('handles multiple colored segments', () => {
    const result = parseAnsi('\x1b[32m✓\x1b[0m \x1b[31m✗\x1b[0m')
    const text = extractText(result)
    expect(text).toContain('✓')
    expect(text).toContain('✗')
    const nodes = Array.isArray(result) ? result : [result]
    expect(nodes.some(n => getStyle(n).color === '#50fa7b')).toBe(true)
    expect(nodes.some(n => getStyle(n).color === '#ff5555')).toBe(true)
  })
})
