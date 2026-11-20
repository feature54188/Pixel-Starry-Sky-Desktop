import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { foldTurns, type Item } from '@pixelsky/protocol'
import { EntryView } from './ItemView'

it('shows the measured steps next to the step count even when the turn took much longer', () => {
  const items: Item[] = [
    { kind: 'user', id: 'u', text: 'test', createdAt: 0 },
    { kind: 'file_change', id: 'a', changes: [], status: 'completed', stepTiming: { start: 1000, end: 1100 } },
    { kind: 'file_change', id: 'b', changes: [], status: 'completed', stepTiming: { start: 5000, end: 5150 } },
    { kind: 'turn_stats', id: 'stats', turnId: 't', outcome: 'completed', usage: { models: {}, durationMs: 75_000 } },
  ]
  const entry = foldTurns(items, false).find(e => e.type === 'process')!
  const html = renderToStaticMarkup(
    <EntryView
      entry={entry}
      last
      waiting={false}
      truncated={[]}
      onDetail={vi.fn()}
      actions={{ sessionId: 's', image: vi.fn(), view: vi.fn(), retryId: null, retrying: false, retry: vi.fn() }}
    />,
  )
  expect(html).toContain('做了 2 步')
  expect(html).toContain('250 ms')
})
