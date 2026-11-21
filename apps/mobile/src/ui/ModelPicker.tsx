import { useEffect, useState } from 'react'
import { ENGINES, type PhoneModelChoice } from '@pixelsky/protocol'
import { L } from '@/i18n'
import { Sheet } from '@/ui/sheet'
import { Segmented, Spinner } from '@/ui'

export function ModelPicker({
  deviceId,
  loadChoices,
  onPick,
  onClose,
}: {
  loadChoices(
    deviceId: string,
    kind: PhoneModelChoice['source']['kind'],
  ): Promise<PromiseSettledResult<PhoneModelChoice[]>[]>
  deviceId: string
  onPick(choice: PhoneModelChoice): void
  onClose(): void
}) {
  const [kind, setKind] = useState<PhoneModelChoice['source']['kind']>('platform')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState('')
  const [rows, setRows] = useState<PhoneModelChoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setRows([])
    setExpanded('')
    setLoading(true)
    setError('')
    void loadChoices(deviceId, kind).then(results => {
      if (!active) return
      setRows(results.flatMap(r => (r.status === 'fulfilled' ? (r.value ?? []) : [])))
      const failed = results.find(r => r.status === 'rejected')
      if (failed?.status === 'rejected') setError(String(failed.reason.message ?? failed.reason))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [deviceId, kind, loadChoices])
  const groups = new Map<string, PhoneModelChoice[]>()
  for (const row of rows) {
    if (![row.model, row.name, ENGINES[row.engine].name].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
      continue
    const routes = groups.get(row.model) ?? []
    routes.push(row)
    groups.set(row.model, routes)
  }
  return (
    <Sheet title={L('选择模型和线路', 'Choose model and route')} onClose={onClose}>
      <div className="space-y-3 px-5 pb-4">
        <input
          type="search"
          className="w-full rounded-xl border border-line-subtle px-3 py-2"
          placeholder={L('搜索全部模型', 'Search models')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <Segmented<PhoneModelChoice['source']['kind']>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'platform', label: L('平台', 'Platform') },
            { value: 'self', label: L('自己的账号', 'Own account') },
            { value: 'provider', label: L('自定义接口', 'Custom API') },
          ]}
        />
        {loading ? (
          <Spinner size={18} />
        ) : (
          groups.size === 0 && <p>{error || L('没有符合条件的模型', 'No matching models')}</p>
        )}
        {[...groups].map(([model, choices]) => (
          <section key={model}>
            <button
              className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
              onClick={() => setExpanded(expanded === model ? '' : model)}
            >
              <span>{model}</span>
              <small>
                {kind === 'platform' && '×' + Math.min(...choices.map(c => c.rate ?? 1)) + ' · '}
                {choices.length} {L('个选项', 'options')}
              </small>
            </button>
            {expanded === model &&
              choices.map(c => (
                <button
                  key={JSON.stringify([c.engine, c.source])}
                  className="block min-h-11 w-full rounded-lg bg-subtle px-3 text-left"
                  onClick={() => onPick(c)}
                >
                  {ENGINES[c.engine].name} · {c.name} {c.rate !== undefined && '×' + c.rate}{' '}
                  {c.billing &&
                    (c.billing === 'plan_only' ? L('订阅额度', 'Subscription') : L('余额计费', 'Balance billing'))}
                </button>
              ))}
          </section>
        ))}
      </div>
    </Sheet>
  )
}
