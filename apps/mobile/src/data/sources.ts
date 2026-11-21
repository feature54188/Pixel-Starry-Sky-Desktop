import { ENGINE_ORDER } from '@pixelsky/protocol'
import { connections } from '@/connection'
import type { PhoneModelChoice, PhoneSource, PhoneSources, SessionRecord } from '@pixelsky/protocol'
import { L } from '@/i18n'
import type { ModeOption } from './mode'

export function recordSource(record: Pick<SessionRecord, 'platform' | 'provider'>): string {
  if (record.platform) return 'platform:' + record.platform.groupId
  if (record.provider) return 'provider:' + record.provider.id
  return 'self'
}

export function phoneSource(key: string): PhoneSource {
  if (key.startsWith('platform:')) return { kind: 'platform', groupId: key.slice(9) }
  if (key.startsWith('provider:')) return { kind: 'provider', id: key.slice(9) }
  return { kind: 'self' }
}

export function sourceOptions(s: PhoneSources): ModeOption[] {
  return [
    { value: 'self', label: L('自己的账号', 'My own account') },
    ...(s.platform ?? []).map(p => ({
      value: 'platform:' + p.id,
      label: L('平台 · ', 'Platform · ') + p.name,
      hint: '×' + p.rate,
    })),
    ...s.providers.map(p => ({ value: 'provider:' + p.id, label: L('自定义接口 · ', 'Custom API · ') + p.name })),
  ]
}

export function sourceModels(s: PhoneSources | null, key: string): string[] | null {
  if (key.startsWith('platform:')) return s?.platform?.find(p => p.id === key.slice(9))?.models ?? []
  if (key.startsWith('provider:')) return s?.providers.find(p => p.id === key.slice(9))?.models ?? []
  return null
}

export function confirmSource(s: PhoneSources, from: string, to: string): boolean {
  const line = s.platform?.find(p => 'platform:' + p.id === to)
  const previous = s.platform?.find(p => 'platform:' + p.id === from)
  return (
    !line ||
    (!!previous && previous.rate >= line.rate) ||
    confirm(
      L(`使用平台线路「${line.name}」（倍率 ×${line.rate}）？`, `Use platform route “${line.name}” at ×${line.rate}?`),
    )
  )
}

export async function loadModelChoices(deviceId: string, kind: PhoneSource['kind']) {
  const link = connections.link(deviceId)
  return link
    ? Promise.allSettled(ENGINE_ORDER.map(engine => link.call<PhoneModelChoice[]>('modelChoices', engine, kind)))
    : []
}
