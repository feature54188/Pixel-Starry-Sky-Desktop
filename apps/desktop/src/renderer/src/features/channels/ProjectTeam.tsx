import { useRef, useState } from 'react'
import type { EngineId } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useEngineState } from '@/features/engine'
import { Button, Select, useToast } from '@/ui'
import type { ProjectChannelTemplate } from '../../../../shared/types/channels'
import { useProjectOptions } from './ChannelDialogs'
import { duplicateName } from './model'
import { usePresets } from './presets'
import { channelActions, useChannels } from './store'

function developmentTeam(engine: EngineId): ProjectChannelTemplate {
  const roles = [
    ['lead', tr('channels.template.lead'), tr('channels.template.leadRole')],
    ['developer', tr('channels.template.developer'), tr('channels.template.devRole')],
    ['reviewer', tr('channels.template.reviewer'), tr('channels.template.reviewRole')],
  ]
  return {
    lead: 'lead',
    relay: true,
    members: roles.map(([sourceId, name, instructions]) => ({
      sourceId,
      config: { name, instructions, engine, settings: {}, mode: 'per-task' },
    })),
  }
}

export function ProjectTeam({ manage }: { manage: () => void }) {
  useI18n()
  const projects = useProjectOptions()
  const current = useEngineState(s => s.currentProjectId)
  const engines = useEngineState(s => s.engines)
  const channels = useChannels(s => s.channels)
  const presets = usePresets()
  const toast = useToast()
  const [selection, select] = useState<string | null>(null)
  const [override, setProject] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const project =
    projects.find(p => p.value === (override ?? current) && !p.disabled) ?? projects.find(p => !p.disabled)
  const preset = presets.items.find(p => p.id === (selection ?? presets.defaultId))
  const label = preset?.name ?? tr('channels.template.devTeam')
  const ready = engines.filter(e => e.id !== 'dot' && e.status === 'ready')
  const engine = ready.find(e => e.id === 'codex') ?? ready[0]
  const create = async () => {
    if (sending.current || !project || (!preset && !engine)) return
    sending.current = true
    setBusy(true)
    try {
      const template = preset ? { ...preset, members: preset.members ?? [] } : developmentTeam(engine!.id)
      const base = (String(project.label) + ' · ' + label).slice(0, 40).trim()
      const taken = channels.filter(c => c.scope === 'local').map(c => c.name)
      const name = taken.some(n => n.toLowerCase() === base.toLowerCase()) ? duplicateName(base, taken) : base
      await channelActions.createChannel({ name, projectId: project.value, template })
    } catch (error) {
      toast(translateMessage((error as Error).message))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Select
        label={tr('channels.dialog.project')}
        placeholder={tr('channels.dialog.project')}
        options={projects}
        value={project?.value ?? ''}
        onChange={setProject}
      />
      <Select
        label={tr('channels.template.label')}
        options={[
          { value: 'builtin', label: tr('channels.template.devTeam') },
          ...presets.items.map(p => ({ value: p.id, label: p.name })),
        ]}
        value={preset?.id ?? 'builtin'}
        onChange={select}
      />
      <div className="flex items-center justify-between gap-1">
        <Button
          variant="primary"
          disabled={busy || !project || (!preset && !engine)}
          title={!preset && !engine ? tr('channels.template.needEngine') : undefined}
          onClick={() => void create()}
        >
          {tr('channels.template.quick')}
        </Button>
        <Button variant="ghost" onClick={manage}>
          {tr('channels.template.manage')}
        </Button>
      </div>
    </div>
  )
}
