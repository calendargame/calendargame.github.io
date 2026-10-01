// @vitest-environment jsdom
//
// How-to-Play text selection. The guide's section bodies and header titles are
// selectable (`select-text`, the index.css allow-list), which creates one hazard: the
// title span lives inside the header <button>, so a desktop drag-select across a title
// fires the button's click on mouse-up and would collapse the panel out from under the
// fresh selection. lib/selectionGuard owns the suppression rule; these tests pin the
// pure predicate on real DOM nodes, the GuideSection onClick wiring around it, and the
// select-text class placement (body wrapper + title span — NOT the button itself, so
// the chevron and padding stay non-selectable).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { GuideSection } from '../src/components/GuidePage.jsx'
import { selectionSuppressesToggle } from '../src/lib/selectionGuard.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('selectionSuppressesToggle (pure predicate)', () => {
  // A real header-shaped DOM fragment: button > span > text, plus an outside node.
  const build = () => {
    const header = document.createElement('button')
    const title = document.createElement('span')
    title.textContent = 'Install and offline'
    header.appendChild(title)
    const outside = document.createElement('p')
    outside.textContent = 'body copy'
    return { header, titleText: title.firstChild, outside }
  }
  it('null selection never suppresses (WebKit can return null)', () => {
    const { header } = build()
    expect(selectionSuppressesToggle(null, header)).toBe(false)
  })
  it('a collapsed selection (bare caret — what every ordinary click leaves) never suppresses', () => {
    const { header, titleText } = build()
    expect(selectionSuppressesToggle({ isCollapsed: true, anchorNode: titleText }, header)).toBe(
      false,
    )
  })
  it('a non-collapsed selection anchored inside the header suppresses', () => {
    const { header, titleText } = build()
    expect(selectionSuppressesToggle({ isCollapsed: false, anchorNode: titleText }, header)).toBe(
      true,
    )
    // Anchored AT the header element itself counts as inside (Node.contains includes self).
    expect(selectionSuppressesToggle({ isCollapsed: false, anchorNode: header }, header)).toBe(true)
  })
  it('a non-collapsed selection anchored elsewhere must not eat taps on this header', () => {
    const { header, outside } = build()
    expect(
      selectionSuppressesToggle({ isCollapsed: false, anchorNode: outside.firstChild }, header),
    ).toBe(false)
  })
  it('a non-collapsed selection with no anchor node never suppresses', () => {
    const { header } = build()
    expect(selectionSuppressesToggle({ isCollapsed: false, anchorNode: null }, header)).toBe(false)
  })
})

describe('GuideSection header toggle wiring', () => {
  const renderSection = () => {
    const onToggle = vi.fn()
    const utils = render(
      <GuideSection id="overview" title="What Is Calendar Game?" openId={null} onToggle={onToggle}>
        <p>Some body copy.</p>
      </GuideSection>,
    )
    return { onToggle, ...utils, button: utils.container.querySelector('button') }
  }
  const mockSelection = (sel) => vi.spyOn(window, 'getSelection').mockReturnValue(sel)

  it('a plain click toggles the section', () => {
    const { onToggle, button } = renderSection()
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('overview')
  })
  it('a drag-select over the title (non-collapsed, anchored in the header) skips the toggle', () => {
    const { onToggle, button, getByText } = renderSection()
    mockSelection({
      isCollapsed: false,
      anchorNode: getByText('What Is Calendar Game?').firstChild,
    })
    fireEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
  })
  it('a selection standing elsewhere (e.g. in a body) does not block the header', () => {
    const { onToggle, button, getByText } = renderSection()
    mockSelection({ isCollapsed: false, anchorNode: getByText('Some body copy.').firstChild })
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
  it('a collapsed selection inside the header (an ordinary tap) still toggles', () => {
    const { onToggle, button, getByText } = renderSection()
    mockSelection({ isCollapsed: true, anchorNode: getByText('What Is Calendar Game?').firstChild })
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('select-text allow-list placement', () => {
  it('the body wrapper and the title span opt in; the header button itself does not', () => {
    const { container, getByText } = render(
      <GuideSection id="overview" title="What Is Calendar Game?" openId={null} onToggle={() => {}}>
        <p>Some body copy.</p>
      </GuideSection>,
    )
    expect(getByText('What Is Calendar Game?').classList.contains('select-text')).toBe(true)
    const body = getByText('Some body copy.').parentElement
    expect(body.classList.contains('select-text')).toBe(true)
    expect(container.querySelector('button').classList.contains('select-text')).toBe(false)
  })
})
