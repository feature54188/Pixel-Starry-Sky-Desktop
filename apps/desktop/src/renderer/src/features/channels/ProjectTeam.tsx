import { useRef, useState } from 'react'
import type { EngineId } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useEngineState } from '@/features/engine'
import { Select } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { setPage } from '@/features/layout/page'
import { type ChannelPreset } from './presets'
import { useProjectOptions } from './ChannelDialogs'
import { duplicateName } from './model'
import { channelActions, useChannels } from './store'

export function developmentTeam(engine: EngineId): ChannelPreset {
  const roles = [
    ['lead', tr('channels.template.lead'), tr('channels.template.leadRole')],
    ['developer', tr('channels.template.developer'), tr('channels.template.devRole')],
    ['reviewer', tr('channels.template.reviewer'), tr('channels.template.reviewRole')],
  ]
  return {
    id: 'builtin',
    name: tr('channels.template.devTeam'),
    updatedAt: 0,
    lead: 'lead',
    relay: true,
    members: roles.map(([sourceId, name, instructions]) => ({
      sourceId,
      config: { name, instructions, engine, settings: {}, mode: 'per-task' },
    })),
  }
}

export function ProjectTeam({ preset, onClose }: { preset: ChannelPreset; onClose: () => void }) {
  useI18n()
  const projects = useProjectOptions()
  const current = useEngineState(s => s.currentProjectId)
  const channels = useChannels(s => s.channels)
  const [error, setError] = useState<string | null>(null)
  const [override, setProject] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const project =
    projects.find(p => p.value === (override ?? current) && !p.disabled) ?? projects.find(p => !p.disabled)
  const create = async () => {
    if (sending.current || !project) return
    sending.current = true
    setBusy(true)
    try {
      const template = { ...preset, members: preset.members ?? [] }
      const base = (String(project.label) + ' · ' + preset.name).slice(0, 40).trim()
      const taken = channels.filter(c => c.scope === 'local').map(c => c.name)
      const name = taken.some(n => n.toLowerCase() === base.toLowerCase()) ? duplicateName(base, taken) : base
      await channelActions.createChannel({ name, projectId: project.value, template })
      onClose()
      setPage('channels')
    } catch (error) {
      setError(translateMessage((error as Error).message))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <ConfirmDialog
      title={tr('channels.template.useTitle', { name: preset.name })}
      confirmLabel={tr('channels.template.quick')}
      confirmDisabled={!project}
      cancelLabel={tr('channels.dialog.cancel')}
      busy={busy}
      error={error}
      onConfirm={() => void create()}
      onCancel={onClose}
      description={
        <div className="flex flex-col gap-2">
          <label className="text-meta text-fg-muted">{tr('channels.dialog.project')}</label>
          <Select
            label={tr('channels.dialog.project')}
            placeholder={tr('channels.dialog.project')}
            options={projects}
            value={project?.value ?? ''}
            onChange={setProject}
          />
          {!project && <p className="text-meta text-fg-muted">{tr('channels.agent.noProjects')}</p>}
        </div>
      }
    />
  )
}
