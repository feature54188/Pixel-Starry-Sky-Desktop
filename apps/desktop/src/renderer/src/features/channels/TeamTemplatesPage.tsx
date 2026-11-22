import { useState } from 'react'
import { Plus, Pencil, Trash2, PanelsTopLeft } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, cn, EngineIcon, IconButton, Select, useToast } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useEngineState } from '@/features/engine'
import { isReservedMentionName } from '../../../../shared/channels/mentions'
import { RelayRulesEditor } from './RelayRules'
import { AlertRulesEditor } from './AlertRules'
import { relayRulesOf } from '../../../../shared/types/channels'
import {
  alertRulesOf,
  DIGEST_HOUR,
  DEFAULT_MAX_REJECTS,
  STALLED_MINUTES,
  MAX_REJECTS_RANGE,
} from '../../../../shared/channels/alerts'
import { AgentDialog } from './ChannelDialogs'
import { developmentTeam, ProjectTeam } from './ProjectTeam'
import { channelsLive } from './store'
import { duplicateName } from './model'
import {
  PRESET_NAME_MAX,
  sameName,
  setPresets,
  usePresets,
  withPreset,
  withoutPreset,
  type ChannelPreset,
  type PresetMemberConfig,
} from './presets'

type Dialog = 'new' | 'copy' | 'rename' | 'delete' | 'use' | null

export function TeamTemplatesPage() {
  useI18n()
  const presets = usePresets()
  const engines = useEngineState(s => s.engines)
  const ready = engines.filter(e => e.id !== 'dot' && e.status === 'ready')
  const engine = ready.find(e => e.id === 'codex') ?? ready[0]
  const builtin = developmentTeam(engine?.id ?? 'codex')
  const [selected, select] = useState<string | null>(null)
  const preset = presets.items.find(p => p.id === (selected ?? presets.defaultId)) ?? builtin
  const custom = preset.id !== builtin.id
  const members = preset.members ?? []
  const [dialog, show] = useState<Dialog>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingMember, editMember] = useState<{ id: string | null } | null>(null)
  const toast = useToast()
  const open = (action: Dialog) => {
    setError(null)
    const taken = [builtin.name, ...presets.items.map(p => p.name)]
    setName(action === 'rename' ? preset.name : action === 'copy' ? duplicateName(preset.name, taken) : '')
    show(action)
  }
  const save = (next: ChannelPreset) => {
    setPresets(withPreset(presets, { ...next, updatedAt: Date.now() }, false))
  }
  const update = (patch: Partial<ChannelPreset>) => {
    if (!custom) return
    try {
      save({ ...preset, ...patch })
    } catch (e) {
      toast(translateMessage((e as Error).message))
    }
  }
  const submitName = () => {
    const label = name.trim()
    if (!label) return
    if ([builtin, ...presets.items].some(p => sameName(p.name, label) && (dialog !== 'rename' || p.id !== preset.id))) {
      setError(tr('channels.preset.nameTaken'))
      return
    }
    const id = dialog === 'rename' ? preset.id : crypto.randomUUID()
    const next = dialog === 'new' ? { members: [], relay: true } : preset
    try {
      save({ ...next, id, name: label, updatedAt: Date.now() })
      select(id)
      show(null)
    } catch (e) {
      setError(translateMessage((e as Error).message))
    }
  }
  const saveMember = (config: PresetMemberConfig) => {
    if (
      isReservedMentionName(config.name) ||
      members.some(m => m.sourceId !== editingMember?.id && sameName(m.config.name, config.name))
    )
      throw new Error(tr('channels.template.memberNameTaken'))
    const id = editingMember?.id ?? crypto.randomUUID()
    const next = { sourceId: id, config }
    save({
      ...preset,
      members: editingMember?.id ? members.map(m => (m.sourceId === id ? next : m)) : [...members, next],
    })
  }
  return (
    <main data-team-templates className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <nav
        aria-label={tr('channels.template.label')}
        className="flex w-[220px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-4"
      >
        <Button variant="ghost" onClick={() => open('new')}>
          <Plus size={15} />
          {tr('channels.template.new')}
        </Button>
        {[builtin, ...presets.items].map(p => (
          <button
            type="button"
            key={p.id}
            aria-pressed={p.id === preset.id}
            onClick={() => select(p.id)}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left text-list hover:bg-hover',
              p.id === preset.id && 'bg-accent-soft text-accent-fg',
            )}
          >
            <PanelsTopLeft size={15} className="shrink-0" />
            <span className="truncate">{p.name}</span>
            {p.id === presets.defaultId && (
              <span className="ml-auto text-meta text-fg-muted">{tr('channels.preset.isDefault')}</span>
            )}
          </button>
        ))}
      </nav>
      <section className="min-w-0 flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 break-words text-lg font-semibold text-fg">{preset.name}</h2>
            <Button
              variant="primary"
              disabled={!channelsLive || (!custom && !engine)}
              title={!custom && !engine ? tr('channels.template.needEngine') : undefined}
              onClick={() => open('use')}
            >
              {tr('channels.template.quick')}
            </Button>
          </header>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => open('copy')}>
              {tr('channels.template.copy')}
            </Button>
            {custom && (
              <>
                <Button variant="ghost" onClick={() => open('rename')}>
                  {tr('channels.preset.rename')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    try {
                      setPresets({ ...presets, defaultId: presets.defaultId === preset.id ? null : preset.id })
                    } catch (e) {
                      toast(translateMessage((e as Error).message))
                    }
                  }}
                >
                  {tr(presets.defaultId === preset.id ? 'channels.preset.unsetDefault' : 'channels.preset.setDefault')}
                </Button>
                <Button variant="ghost" onClick={() => open('delete')}>
                  {tr('channels.preset.delete')}
                </Button>
              </>
            )}
          </div>
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-list font-medium text-fg">{tr('channels.preset.partMembers')}</h3>
              {custom && (
                <Button variant="ghost" onClick={() => editMember({ id: null })}>
                  <Plus size={14} />
                  {tr('channels.agent.addTitle')}
                </Button>
              )}
            </div>
            {members.length === 0 && <p className="text-meta text-fg-muted">{tr('channels.preset.noMembers')}</p>}
            {members.map(({ sourceId, config }) => (
              <div key={sourceId} className="flex items-start gap-3 rounded-lg border border-line-card px-3 py-3">
                <EngineIcon engine={config.engine} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-fg">{config.name}</span>
                    <span className="text-meta text-fg-muted">
                      {[config.engine, config.settings.model, config.settings.effort].filter(Boolean).join(' · ')}
                    </span>
                    {!custom && sourceId === preset.lead && (
                      <span className="text-meta text-accent-fg">{tr('channels.template.lead')}</span>
                    )}
                  </div>
                  {config.instructions && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-meta text-fg-secondary">
                      {config.instructions}
                    </p>
                  )}
                  {custom && preset.lead !== sourceId && (
                    <label className="mt-2 flex items-center gap-2 text-meta text-fg-muted">
                      <input
                        type="checkbox"
                        checked={preset.reserveIds?.includes(sourceId) ?? false}
                        onChange={e =>
                          update({
                            reserveIds: e.target.checked
                              ? [...(preset.reserveIds ?? []), sourceId]
                              : preset.reserveIds?.filter(id => id !== sourceId),
                          })
                        }
                      />
                      {tr('channels.template.candidate')}
                    </label>
                  )}
                </div>
                {custom && (
                  <>
                    <IconButton
                      label={tr('channels.agent.editTitle', { name: config.name })}
                      icon={Pencil}
                      size={26}
                      onClick={() => editMember({ id: sourceId })}
                    />
                    <IconButton
                      label={tr('channels.template.removeMember', { name: config.name })}
                      icon={Trash2}
                      size={26}
                      onClick={() =>
                        update({
                          members: members.filter(m => m.sourceId !== sourceId),
                          lead: preset.lead === sourceId ? null : preset.lead,
                          reserveIds: preset.reserveIds?.filter(id => id !== sourceId),
                        })
                      }
                    />
                  </>
                )}
              </div>
            ))}
            {custom && members.length > 0 && (
              <div className="mt-2 flex items-center gap-3 text-list">
                <span>{tr('channels.dialog.lead')}</span>
                <Select
                  label={tr('channels.dialog.lead')}
                  value={preset.lead ?? ''}
                  options={[
                    { value: '', label: tr('channels.dialog.leadNone') },
                    ...members.map(m => ({ value: m.sourceId, label: m.config.name })),
                  ]}
                  onChange={id => update({ lead: id || null, reserveIds: preset.reserveIds?.filter(r => r !== id) })}
                />
              </div>
            )}
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-list font-medium text-fg">{tr('channels.roster.settings')}</h3>
            <fieldset disabled={!custom} className="flex flex-col gap-3 text-list text-fg-secondary">
              <label className="flex flex-col gap-1">
                {tr('channels.dialog.notes')}
                <textarea
                  maxLength={2000}
                  rows={3}
                  className="rounded-md border border-line bg-surface px-2 py-1"
                  value={preset.notes ?? ''}
                  onChange={e => update({ notes: e.target.value })}
                />
              </label>
              {(['planFirst', 'relay', 'leadRoute', 'leadWake', 'leadDispatchOnly'] as const).map(key => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={preset[key] ?? !['relay', 'leadDispatchOnly'].includes(key)}
                    onChange={e => update({ [key]: e.target.checked })}
                  />
                  {tr(`channels.dialog.${key}`)}
                </label>
              ))}
              {preset.relay && (
                <RelayRulesEditor value={relayRulesOf(preset)} onChange={relayRules => update({ relayRules })} />
              )}
              <label className="flex items-center gap-2">
                {tr('channels.preset.partAlerts')}
                <select
                  value={preset.notify ?? 'all'}
                  onChange={e => update({ notify: e.target.value as ChannelPreset['notify'] })}
                >
                  {(['all', 'important', 'mute'] as const).map(v => (
                    <option value={v} key={v}>
                      {tr(`channels.notify.level.${v}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                {tr('channels.limits.maxRejects')}
                <select
                  value={preset.maxRejects ?? DEFAULT_MAX_REJECTS}
                  onChange={e => update({ maxRejects: Number(e.target.value) })}
                >
                  {Array.from(
                    { length: MAX_REJECTS_RANGE[1] - MAX_REJECTS_RANGE[0] + 1 },
                    (_, i) => i + MAX_REJECTS_RANGE[0],
                  ).map(n => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <AlertRulesEditor
                value={alertRulesOf(preset)}
                digestHour={preset.digestHour ?? DIGEST_HOUR}
                stalledMinutes={preset.stalledMinutes ?? STALLED_MINUTES}
                onChange={alerts => update({ alerts })}
                onDigestHour={digestHour => update({ digestHour })}
                onStalledMinutes={stalledMinutes => update({ stalledMinutes })}
              />
            </fieldset>
          </section>
        </div>
      </section>
      {(dialog === 'new' || dialog === 'copy' || dialog === 'rename') && (
        <ConfirmDialog
          title={tr(
            dialog === 'new'
              ? 'channels.template.new'
              : dialog === 'copy'
                ? 'channels.template.copy'
                : 'channels.preset.rename',
          )}
          confirmLabel={tr('channels.dialog.save')}
          cancelLabel={tr('channels.dialog.cancel')}
          confirmDisabled={!name.trim()}
          focusInput
          busy={false}
          error={error}
          onConfirm={submitName}
          onCancel={() => show(null)}
          description={
            <label className="flex flex-col gap-2 text-meta">
              {tr('channels.preset.name')}
              <input
                value={name}
                maxLength={PRESET_NAME_MAX}
                onChange={e => setName(e.target.value)}
                className="rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg"
              />
            </label>
          }
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={tr('channels.template.deleteTitle', { name: preset.name })}
          description={tr('channels.template.deleteHint')}
          danger
          confirmLabel={tr('channels.preset.deleteConfirm')}
          cancelLabel={tr('channels.dialog.cancel')}
          busy={false}
          error={error}
          onCancel={() => show(null)}
          onConfirm={() => {
            try {
              setPresets(withoutPreset(presets, preset.id))
              select(null)
              show(null)
            } catch (e) {
              setError(translateMessage((e as Error).message))
            }
          }}
        />
      )}
      {dialog === 'use' && <ProjectTeam preset={preset} onClose={() => show(null)} />}
      {editingMember && (
        <AgentDialog
          editing={null}
          others={[]}
          onClose={() => editMember(null)}
          template={{
            config: members.find(m => m.sourceId === editingMember.id)?.config,
            names: members.map(m => m.config.name),
            save: saveMember,
          }}
        />
      )}
    </main>
  )
}
