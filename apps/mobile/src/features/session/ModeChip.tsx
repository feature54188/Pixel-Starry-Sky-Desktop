// 输入框卡片里「+」右边的两颗模式胶囊「每步问我」「Sonnet 4.5 · 中」：点哪颗都打开同一个面板，改权限模式、模型、强度（C2，docs/mobile-remote.md §21.5）。
// 没有外层容器和边距，由输入框那一排摆放；地方不够时胶囊自己收窄、文字截断。
// 改了马上发给电脑（engine:updateSession），电脑推回来的会话记录变了，胶囊跟着变。
// 往更宽的权限切确认一次；完全放行手机上开不了，电脑上已经开着的只能往下降。只看档的手机只能看。
// 能力和模型目录按「下一个引擎」算（运行中选了别的引擎还没生效时，设置算它的，和电脑网关一致）；
// 平台和自定义接口的模型从电脑上该来源的列表读取。
// 快速模式（§25）：引擎有 fast 才显示开关，打开确认一次（按更高的价格计费），开着时模型胶囊末尾「⚡快速」。
import { useState } from 'react'
import { Zap } from 'lucide-react'
import {
  ENGINES,
  type Effort,
  type PermissionMode,
  type PhoneSource,
  type SessionFlags,
  type SessionRecord,
} from '@pixelsky/protocol'
import type { DesktopLink } from '@/connection'
import { ModelPicker } from '@/ui/ModelPicker'
import { useCatalog, useSources, usePhoneOption, usePanelDefaults } from '@/data/hooks'
import { loadModelChoices, confirmSource, phoneSource, recordSource, sourceModels, sourceOptions } from '@/data/sources'
import {
  effortOptions,
  fastConfirm,
  fastStatus,
  modeChip,
  modelOptions,
  permissionOptions,
  confirmPermission,
} from '@/data/mode'
import { L } from '@/i18n'
import { cn } from '@/ui'
import { ModeSheet } from '@/ui/ModeSheet'

/** 胶囊：和输入框里的圆键同高；两颗都能收窄，文字在里面截断 */
const pill =
  'inline-flex h-9 min-w-0 items-center gap-1 rounded-full border border-line-subtle bg-surface px-3 text-meta text-fg active:bg-hover'

type Patch = Partial<
  Pick<
    SessionRecord,
    'permissionMode' | 'model' | 'effort' | 'thinkingSummaries' | 'fast' | 'ultrafast' | 'planReturn' | 'engine'
  >
> & {
  source?: PhoneSource
}

/** 电脑回的错误代码 → 给人看的话；别的原样 */
function errorText(code: string): string {
  switch (code) {
    case 'MOBILE_FORBIDDEN':
      return L('这部手机是「只看」，改不了。', "This phone is set to “View only” and can't change this.")
    case 'MOBILE_UNSUPPORTED':
      return L(
        '电脑上的像素星空版本较旧，先更新电脑版。',
        'The PixelSky app on your computer is out of date. Update it first.',
      )
    case 'MOBILE_BAD_ARGUMENT':
      return L('电脑不接受这个设置。', "The computer didn't accept this setting.")
    default:
      return code
  }
}

export function ModeChip({
  deviceId,
  link,
  sessionId,
  record,
  flags,
  canAct,
}: {
  deviceId: string
  link: DesktopLink | undefined
  sessionId: string
  record: SessionRecord
  /** 快速模式能不能开、是否在冷却（电脑上引擎报告的） */
  flags: SessionFlags | null
  canAct: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const engine = record.nextEngine ?? record.engine
  const source = recordSource(record)
  const sources = useSources(deviceId, engine, open)
  const routeModels = sourceModels(sources.data, source)
  const catalog = useCatalog(deviceId, engine, open && routeModels === null)
  const chip = modeChip(record)
  const modelText = [chip.model, chip.effort].filter(Boolean).join(' · ') || L('默认', 'Default')
  const caps = ENGINES[engine]?.caps
  const model = routeModels === null ? catalog.models?.find(m => m.id === record.model) : undefined
  const unsupported = routeModels === null && catalog.unsupported
  const fast = fastStatus(flags)
  const parity = sources.data?.composer === true
  const planning = record.permissionMode === 'plan'
  const level = parity && planning ? (record.planReturn ?? 'ask') : record.permissionMode
  const [pickModel, setPickModel] = useState(false)
  const speed = usePhoneOption<{ allowed: boolean; multiplier: number | null }>(
    deviceId,
    'speedOption',
    [engine, phoneSource(source), record.model],
    open && parity,
  )
  const checks = usePhoneOption<boolean>(deviceId, 'projectTools:sessionChecks', [sessionId], open && parity)
  const defaults = usePanelDefaults(deviceId, engine, open && parity, {
    ...(caps.efforts.length ? { effort: record.effort } : {}),
    ...(caps.fast ? { fast: record.fast } : {}),
    ...(caps.thinkingSummaries ? { thinkingSummaries: record.thinkingSummaries } : {}),
  })
  const [checksOverride, setChecksOverride] = useState<boolean | null>(null)
  const changeChecks = async (on: boolean) => {
    if (!link || busy) return
    setBusy(true)
    try {
      await link.call('projectTools:setSessionChecks', sessionId, on)
      setChecksOverride(on)
      setError(null)
    } catch (e) {
      setError(errorText((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (patch: Patch) => {
    if (!link) return
    setBusy(true)
    setError(null)
    try {
      await link.call('engine:updateSession', sessionId, patch, ...(patch.engine ? ['modelChoice'] : []))
    } catch (e) {
      const code = (e as Error).message
      setError(errorText(code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setChecksOverride(null)
          setOpen(true)
        }}
        className={cn(pill, 'shrink')}
      >
        <span className="truncate">{chip.permission}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setChecksOverride(null)
          setOpen(true)
        }}
        className={cn(pill, 'max-w-44 shrink-[2]')}
      >
        <span className="truncate">{modelText}</span>
        {record.fast && caps?.fast && (
          <span
            data-fast-chip
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 font-medium',
              fast.cooldown ? 'text-fg-faint line-through' : 'text-warn',
            )}
          >
            <Zap size={13} fill="currentColor" />
            {L('快速', 'Fast')}
          </span>
        )}
      </button>
      {open && pickModel && (
        <ModelPicker
          loadChoices={loadModelChoices}
          deviceId={deviceId}
          onClose={() => setPickModel(false)}
          onPick={choice => {
            setPickModel(false)
            void apply({
              engine: choice.engine,
              source: choice.source,
              model: choice.model,
              effort: null,
              fast: false,
              ultrafast: false,
            })
          }}
        />
      )}
      {open && !pickModel && (
        <ModeSheet
          defaultsActions={
            defaults.defaults
              ? {
                  changed: !!defaults.changed,
                  save: defaults.save,
                  reset: () => {
                    const d = defaults.defaults!
                    void apply({
                      ...(caps.efforts.length ? { effort: d.effort } : {}),
                      ...(caps.fast ? { fast: d.fast, ultrafast: false } : {}),
                      ...(caps.thinkingSummaries ? { thinkingSummaries: d.thinkingSummaries } : {}),
                    })
                  },
                }
              : undefined
          }
          modelPicker={parity ? () => setPickModel(true) : undefined}
          title={L('这个会话的模式', 'Conversation mode')}
          busy={busy}
          readOnly={!canAct || unsupported}
          error={
            error ??
            (defaults.error || sources.error) ??
            (unsupported
              ? L(
                  '电脑上的像素星空版本较旧，手机还不能改模式。',
                  "The PixelSky app on your computer is out of date, so the phone can't change modes yet.",
                )
              : !canAct
                ? L(
                    '没连上电脑，或这部手机是「只看」。',
                    'Not connected to the computer, or this phone is set to “View only”.',
                  )
                : null)
          }
          note={[
            caps &&
              !caps.liveModelSwitch &&
              L('模型和强度下一轮生效。', 'Model and effort changes apply from the next turn.'),
            caps &&
              !caps.livePermissionSwitch &&
              L('正在运行时改权限，下一轮生效。', 'Permission changes made while running apply from the next turn.'),
            caps?.fast
              ? L(
                  '换模型、调高强度、打开快速模式会改变费用。',
                  'Changing the model, raising effort, or turning on fast mode changes the cost.',
                )
              : L('换模型、调高强度会改变费用。', 'Changing the model or raising effort changes the cost.'),
          ]
            .filter(Boolean)
            .join(L('', ' '))}
          onClose={() => setOpen(false)}
          groups={[
            ...(sources.data
              ? [
                  {
                    key: 'source',
                    title: L('模型来源', 'Model source'),
                    options: sourceOptions(sources.data),
                    value: source,
                    onPick: (v: string) => {
                      if (sources.data && confirmSource(sources.data, source, v))
                        void apply({ source: phoneSource(v), effort: null })
                    },
                  },
                ]
              : []),
            {
              key: 'permission',
              title: L('权限', 'Permissions'),
              options: permissionOptions(engine, level, sources.data?.desktopPermissions, parity),
              value: level,
              onPick: v => {
                const to = v as PermissionMode
                if (!confirmPermission(level, to)) return
                void apply(
                  parity && planning ? { planReturn: to as Exclude<PermissionMode, 'plan'> } : { permissionMode: to },
                )
              },
            },
            {
              key: 'model',
              title: (routeModels === null ? catalog.models === null && !unsupported : !sources.data && !sources.error)
                ? L('模型（正在取）', 'Model (loading)')
                : L('模型', 'Model'),
              options:
                routeModels === null
                  ? modelOptions(catalog.models, record.model)
                  : [...new Set([...(record.model ? [record.model] : []), ...routeModels])].map(id => ({
                      value: id,
                      label: id,
                    })),
              value: record.model ?? '',
              onPick: v => {
                // 新模型不支持现在的强度：一起退回默认，免得留下一个新模型不认的强度
                const next = routeModels === null ? catalog.models?.find(m => m.id === v) : undefined
                const drop = !!record.effort && !!next?.efforts.length && !next.efforts.includes(record.effort)
                void apply({ model: v || null, ...(drop ? { effort: null } : {}) })
              },
            },
            {
              key: 'effort',
              title: L('推理强度', 'Reasoning effort'),
              options: effortOptions(engine, model, record.effort),
              value: record.effort ?? '',
              segmented: true,
              onPick: v => void apply({ effort: (v || null) as Effort | null }),
            },
          ]}
          toggles={[
            ...(parity && caps.permissionModes.includes('plan')
              ? [
                  {
                    key: 'plan',
                    label: L('先出计划', 'Plan first'),
                    value: planning,
                    onChange: (on: boolean) => {
                      const after =
                        level === 'full' || level === 'auto'
                          ? sources.data?.desktopPermissions
                            ? level
                            : 'edits'
                          : level
                      void apply(
                        on
                          ? { permissionMode: 'plan', planReturn: after as Exclude<PermissionMode, 'plan'> }
                          : { permissionMode: after },
                      )
                    },
                  },
                ]
              : []),
            ...(checks !== null
              ? [
                  {
                    key: 'checks',
                    label: L('做完自动检查', 'Run checks after each turn'),
                    value: checksOverride ?? checks,
                    onChange: changeChecks,
                  },
                ]
              : []),
            ...(speed?.allowed ||
            (engine === 'pixel' && flags?.pixelSpeed?.model === record.model && flags.pixelSpeed.ultrafast)
              ? [
                  {
                    key: 'ultrafast',
                    label: 'Ultrafast' + (speed?.multiplier ? ' ×' + speed.multiplier : ''),
                    value: !!record.ultrafast,
                    onChange: (on: boolean) => {
                      if (!on || confirm(fastConfirm())) void apply({ fast: true, ultrafast: on })
                    },
                  },
                ]
              : []),
            ...(caps?.fast
              ? [
                  {
                    key: 'fast',
                    label: L('快速模式', 'Fast mode'),
                    icon: <Zap size={14} fill="currentColor" className="text-warn" />,
                    hint: fast.hint,
                    warn: fast.warn,
                    // 开不了时开关变灰；已经开着的照样能关
                    disabled: !fast.available && !record.fast,
                    value: record.fast,
                    onChange: (v: boolean) => {
                      if (v && !confirm(fastConfirm())) return
                      void apply({ fast: v, ultrafast: false })
                    },
                  },
                ]
              : []),
            ...(caps?.thinkingSummaries
              ? [
                  {
                    key: 'thinking',
                    label: L('显示思考摘要', 'Show thinking summaries'),
                    value: record.thinkingSummaries,
                    onChange: (v: boolean) => void apply({ thinkingSummaries: v }),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  )
}
