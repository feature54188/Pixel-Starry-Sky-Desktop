// 频道协作第二版第一批（docs/ui/channels-collab-v2.md §1、§3、§5）：讨论串、频道工具、提议、交接、成员的扩展设置
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent, HostEvent, ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import type { AgentInput, ChannelTask, ChannelTextMessage } from '../../../shared/types/channels'
import { ChannelStore } from './store'
import { Channels, SELF_ID, type ChannelsDeps } from './service'
import type { CheckRun } from '../../../shared/types/checks'

const projects: ProjectRecord[] = [
  { id: 'p1', name: 'pixel-web', path: 'D:/web' } as ProjectRecord,
  { id: 'ssh-ab~p2', name: 'build', path: '/srv/build' } as ProjectRecord,
]

let dir: string
let now: number
let opened: Channels[]
let calls: { channel: string; args: unknown[] }[]
let sessions: SessionSummary[]

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2))
    for (const c of opened) await (c as unknown as { store: ChannelStore }).store.flush()
  }
}

async function open(channelTools = true, extra: Partial<ChannelsDeps> = {}): Promise<Channels> {
  const store = new ChannelStore(dir)
  await store.init()
  let n = 0
  const c = new Channels({
    store,
    call: async (channel, args) => {
      calls.push({ channel, args })
      if (channel === 'engine:createSession') {
        const o = args[0] as { projectId: string }
        const prefix = o.projectId.includes('~') ? o.projectId.slice(0, o.projectId.indexOf('~') + 1) : ''
        const id = `${prefix}s${++n}`
        sessions.push({ record: { id, projectId: o.projectId }, state: 'idle' } as SessionSummary)
        return { id }
      }
      if (channel === 'engine:send')
        return { queueId: (args[1] as { clientMessageId: string }).clientMessageId, status: 'queued' }
      return null
    },
    emit: () => {},
    machines: () => [
      { id: 'local', name: 'PC', connected: true },
      { id: 'ssh-ab', name: 'build', connected: true },
    ],
    projects: () => projects,
    sessions: () => sessions,
    machineOf: id => (/^ssh-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local'),
    selfName: () => '林夏',
    locale: () => 'zh-CN',
    now: () => ++now,
    channelTools,
    // @ 派活先出计划在 flow.service.test 里测；这里沿用直接派活
    planFirst: false,
    alertTimer: false,
    ...extra,
  })
  opened.push(c)
  return c
}

const agent = (name: string, patch: Partial<AgentInput> = {}): AgentInput => ({
  name,
  engine: 'claude',
  projectId: 'p1',
  copyId: null,
  settings: {},
  instructions: '',
  mode: 'per-task',
  // 同一目录排队另有测试（flow.service.test.ts）；这里的成员照原来一起跑
  sameDir: 'together',
  ...patch,
})
const sends = () =>
  calls
    .filter(c => c.channel === 'engine:send')
    .map(c => ({ sessionId: c.args[0] as string, ...(c.args[1] as { text: string; clientMessageId: string }) }))
const tasks = (c: Channels, id: string) => c.messages(id).messages.filter((m): m is ChannelTask => m.kind === 'task')
const texts = (c: Channels, id: string) =>
  c.messages(id).messages.filter((m): m is ChannelTextMessage => m.kind === 'message')
const ev = (sessionId: string, event: EngineEvent): HostEvent => ({ kind: 'session', sessionId, seq: 0, event })

function finishLast(c: Channels, reply: string): void {
  const s = sends().at(-1)!
  const turn = `turn-${s.clientMessageId}`
  c.hostEvent(
    ev(s.sessionId, {
      type: 'item_completed',
      item: { kind: 'user', id: s.clientMessageId, text: '', createdAt: 0, turnId: turn },
    }),
  )
  c.hostEvent(
    ev(s.sessionId, {
      type: 'item_completed',
      item: { kind: 'assistant', id: `a-${turn}`, text: reply, status: 'completed' },
    }),
  )
  c.hostEvent(ev(s.sessionId, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pixelsky-collab-'))
  now = 1_000_000
  opened = []
  calls = []
  sessions = []
})
afterEach(async () => {
  for (const c of opened) await c.dispose()
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('项目频道模板', () => {
  it('从已删除来源的模板创建新团队，重启后仍使用目标目录及新的牵头 ID', async () => {
    const c = await open()
    const prior = await c.saveMember(null, agent('开发'))
    const template = {
      members: [
        {
          sourceId: 'old',
          config: agent('开发', { projectId: 'gone', copyId: 'old-copy', mode: 'shared', instructions: '实现功能' }),
        },
      ],
      lead: 'old',
      leadDispatchOnly: true,
      notes: '约定',
    }
    const make = (name: string) => c.create({ name, projectId: 'p1', template })
    const [a, b] = await Promise.all([make('甲'), make('乙')])
    const store = new ChannelStore(dir)
    await store.init()
    const lead = store.channels.get(a)!.lead!
    expect(lead).not.toBe(prior)
    expect(lead).not.toBe(store.channels.get(b)!.lead)
    expect(store.channels.get(a)).toMatchObject({ memberIds: [SELF_ID, lead], notes: '约定', leadDispatchOnly: true })
    expect(store.members.find(m => m.id === lead)).toMatchObject({
      projectId: 'p1',
      copyId: null,
      sharedSessionId: null,
      mode: 'shared',
      instructions: '实现功能',
      name: '开发 2',
    })
    await expect(
      c.create({ name: '无效', projectId: 'p1', template: { ...template, lead: 'missing' } }),
    ).rejects.toThrow()
    expect(c.state().channels.some(ch => ch.name === '无效')).toBe(false)
  })
  it('候选只保留定义，按分身名派活、改名和撤下，撤下最后一个后可重新引入', async () => {
    const c = await open()
    const ch = await c.create({
      name: '团队',
      projectId: 'p1',
      template: {
        planFirst: false,
        lead: 'lead',
        reserveIds: ['dev', 'qa'],
        members: [
          { sourceId: 'lead', config: agent('牵头') },
          { sourceId: 'dev', config: agent('开发', { instructions: '实现功能', mode: 'shared' }) },
          { sourceId: 'qa', config: agent('测试') },
        ],
      },
    })
    const state = () => c.state().channels.find(x => x.id === ch)!
    const entry = state().roster!.find(e => e.config.name === '开发')!
    expect(state().memberIds).toHaveLength(2)
    expect(c.memberConfig(entry.id)).toBeNull()
    expect(c.state().members.some(m => m.name === '开发')).toBe(false)
    expect((await c.post(ch, { text: '@开发', clientId: 'candidate' })).tasks).toHaveLength(0)
    await c.post(ch, { text: '@牵头 组队', clientId: 'start' })
    await settle()
    const session = sends().at(-1)!.sessionId
    for (const op of ['list', 'add', 'remove', 'set_role'])
      await expect(c.toolRoster('other', op, '开发')).rejects.toThrow('牵头')
    const list = async () => JSON.parse(await c.toolRoster(session, 'list'))
    expect(await list()).toContainEqual(expect.objectContaining({ name: '开发', candidate: true, clones: [] }))
    await c.toolRoster(session, 'add', '开发')
    const first = c.state().members.find(m => m.name === '开发')!.id
    await c.toolRoster(session, 'set_role', '开发', undefined, '前端')
    await c.toolRoster(session, 'add', '开发')
    const second = c.state().members.find(m => m.name === '开发 2')!.id
    await c.toolRoster(session, 'set_role', '前端', '页面')
    for (const bad of ['开发 2', 'all', '全体', '测试', '过'.repeat(41)]) {
      await expect(c.toolRoster(session, 'set_role', '前端', '覆盖', bad)).rejects.toThrow()
      expect(state().roles?.[first]).toBe('页面')
    }
    expect(state().roles?.[second]).toBeUndefined()
    await c.toolRoster(session, 'set_role', '前端', '修复按钮', '界面')
    await c.post(ch, { text: '@界面 检查', clientId: 'renamed' })
    await settle()
    expect(sends().at(-1)?.text).toContain('修复按钮')
    expect(sends().at(-1)?.text).toContain('实现功能')
    await expect(c.toolRoster(session, 'remove', '界面')).rejects.toThrow('没做完')
    finishLast(c, '完成')
    await settle()
    const originalSession = c.memberConfig(first)!.sharedSessionId
    await c.toolRoster(session, 'set_role', '界面', '', '前端')
    expect(c.memberConfig(first)?.sharedSessionId).toBe(originalSession)
    expect(state().roles?.[first]).toBeUndefined()
    await c.editDefinition(ch, entry.id, { ...entry.config, settings: { model: 'updated' } })
    for (const id of [first, second]) expect(c.memberConfig(id)?.settings.model).toBe('updated')
    expect(state().roster?.find(e => e.id === entry.id)?.config.name).toBe('开发')
    await expect(c.editDefinition(ch, entry.id, null)).rejects.toThrow()
    await expect(c.toolRoster(session, 'remove', '牵头')).rejects.toThrow('更换')
    await c.toolRoster(session, 'remove', '前端')
    await c.toolRoster(session, 'remove', '开发 2')
    expect(await list()).toContainEqual(expect.objectContaining({ name: '开发', candidate: true, clones: [] }))
    await c.toolRoster(session, 'add', '开发')
    await c.toolRoster(session, 'remove', '开发')
    await c.editDefinition(ch, entry.id, null)
    expect(state().roster?.some(e => e.id === entry.id)).toBe(false)
    expect(c.messages(ch).messages).toContainEqual(
      expect.objectContaining({ event: 'memberRenamed', value: '开发 → 前端', actorId: state().lead }),
    )
  })

  it('候选不限数量，并发添加到 20 个在岗后拒绝；新增和引入已有成员都复制配置', async () => {
    const c = await open()
    const candidates = Array.from({ length: 25 }, (_, i) => ({ sourceId: String(i), config: agent('候选' + i) }))
    const ch = await c.create({
      name: '项目',
      projectId: 'p1',
      template: { members: candidates, reserveIds: candidates.map(m => m.sourceId) },
    })
    const source = await c.saveMember(
      null,
      agent('工程师', { engine: 'codex', tools: { mode: 'only', ids: ['review'] } }),
    )
    await c.addMember(ch, source)
    const writer = await c.saveMember(ch, agent('文档'))
    const state = () => c.state().channels.find(x => x.id === ch)!
    const entry = state().roster!.find(e => e.config.name === '工程师')!
    expect(state().memberIds).not.toContain(source)
    expect(c.memberConfig(writer)?.cloneOf).toBeTruthy()
    const results = await Promise.allSettled(Array.from({ length: 19 }, () => c.adjustRoster(ch, entry.id, 'add')))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(18)
    expect(state().memberIds).toHaveLength(21)
    expect(state().roster).toHaveLength(27)
    await expect(c.saveMember(ch, agent('超限'))).rejects.toThrow('20')
    await c.delete(ch)
    expect(c.memberConfig(source)).toBeTruthy()
    expect(c.memberConfig(writer)).toBeNull()
  })

  it('共用会话创建期间改了定义的模型，下一项活会按新配置开会话', async () => {
    let ready!: () => void
    const started = new Promise<void>(resolve => {
      ready = resolve
    })
    let release!: () => void
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const c = await open(true, {
      call: async (channel, args) => {
        calls.push({ channel, args })
        if (channel === 'engine:createSession') {
          ready()
          await pending
          const id = 's' + (sessions.length + 1)
          sessions.push({ record: { id, projectId: 'p1' }, state: 'idle' } as SessionSummary)
          return { id }
        }
        return null
      },
    })
    const ch = await c.create({
      name: '测试',
      projectId: 'p1',
      template: { planFirst: false, members: [{ sourceId: 'dev', config: agent('开发', { mode: 'shared' }) }] },
    })
    const state = c.state().channels.find(x => x.id === ch)!
    const entry = state.roster![0]
    const id = state.memberIds.find(id => id !== SELF_ID)!
    await c.post(ch, { text: '@开发 第一项', clientId: 'one' })
    await started
    await c.editDefinition(ch, entry.id, { ...entry.config, settings: { model: 'new' } })
    release()
    await settle()
    expect(c.memberConfig(id)?.sharedSessionId).toBeNull()
    finishLast(c, '完成')
    await settle()
    await c.post(ch, { text: '@开发 第二项', clientId: 'two' })
    await settle()
    expect(c.memberConfig(id)?.sharedSessionId).toBe('s2')
    expect(calls.filter(call => call.channel === 'engine:createSession').at(-1)?.args[0]).toMatchObject({
      model: 'new',
    })
  })

  it('普通频道仅能查看和调整本频道分工', async () => {
    const c = await open()
    const lead = await c.saveMember(null, agent('牵头'))
    const peer = await c.saveMember(null, agent('开发'))
    const ch = await c.create({ name: '普通', memberIds: [lead, peer] })
    await c.update(ch, { lead })
    await c.post(ch, { text: '@牵头 开工', clientId: 'start' })
    await settle()
    const session = sends().at(-1)!.sessionId
    await expect(c.toolRoster(session, 'add', '开发')).rejects.toThrow()
    await expect(c.toolRoster(session, 'remove', '开发')).rejects.toThrow()
    await c.toolRoster(session, 'set_role', '开发', '排查')
    expect(JSON.parse(await c.toolRoster(session, 'list'))).toContainEqual(
      expect.objectContaining({ name: '开发', ordinary: true, role: '排查' }),
    )
  })

  it('牵头写入本机项目约定会留记录，相同版本只允许一次更新', async () => {
    const root = join(dir, 'project')
    await mkdir(root)
    const c = await open(true, { projects: () => [{ ...projects[0], path: root }, projects[1]] })
    const lead = await c.saveMember(null, agent('牵头'))
    const ch = await c.create({ name: '项目', projectId: 'p1', memberIds: [lead] })
    await c.update(ch, { lead })
    await c.post(ch, { text: '@牵头 写约定', clientId: 'guide' })
    await settle()
    const session = sends().at(-1)!.sessionId
    await expect(c.toolProjectGuide('other', 'read')).rejects.toThrow('牵头')
    const initial = JSON.parse(await c.toolProjectGuide(session, 'read'))
    expect(initial.content).toBe('')
    await writeFile(join(root, 'CLAUDE.md'), 'Claude 专用')
    await mkdir(join(root, '.claude'))
    await writeFile(join(root, '.claude', 'CLAUDE.md'), '规则')
    const hint = JSON.parse(await c.toolProjectGuide(session, 'read')).claudeHint
    expect(hint).toContain('.claude/CLAUDE.md')
    const writes = await Promise.allSettled(
      ['甲', '乙'].map(s => c.toolProjectGuide(session, 'write', s, initial.version)),
    )
    expect(writes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const result of writes)
      if (result.status === 'fulfilled') expect(JSON.parse(result.value).claudeHint).toBe(hint)
    const latest = JSON.parse(await c.toolProjectGuide(session, 'read'))
    expect(latest.content).toBe(await readFile(join(root, 'AGENTS.md'), 'utf8'))
    await expect(c.toolProjectGuide(session, 'write', '字'.repeat(11000), latest.version)).rejects.toThrow('32 KB')
    await writeFile(join(root, 'AGENTS.md'), '手动编辑')
    await expect(c.toolProjectGuide(session, 'write', '覆盖', latest.version)).rejects.toThrow('重新读取')
    expect(c.messages(ch).messages).toContainEqual(
      expect.objectContaining({ kind: 'event', event: 'guideUpdated', actorId: lead }),
    )
    await c.update(ch, { projectId: projects[1].id })
    await expect(c.toolProjectGuide(session, 'read')).rejects.toThrow('本机')
  })
})

describe('讨论串（§3）', () => {
  it('串里不 @ 只是留言；@ 同一成员 = 追加要求；@ 别人开新卡；在串里的消息再开串归到原来的串', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: '1' })
    await settle()
    const card = tasks(c, ch)[0]
    finishLast(c, '改好了')
    await settle()

    const note = await c.post(ch, { text: '颜色再深一点也行', threadId: card.id, clientId: '2' })
    expect(note.tasks).toEqual([])
    expect(note.message.threadId).toBe(card.id)
    expect(note.message.handed).toBeUndefined()
    expect(sends()).toHaveLength(1)

    const more = await c.post(ch, { text: '@前端 禁用状态也改', threadId: card.id, clientId: '3' })
    await settle()
    expect(more.tasks).toEqual([card.id])
    expect(more.message.handed).toEqual({ memberId: a, round: 2 })
    expect(sends()).toHaveLength(2)
    expect(sends()[1].sessionId).toBe(sends()[0].sessionId)
    expect(tasks(c, ch)[0].round).toBe(2)

    const other = await c.post(ch, { text: '@审查员 看一下', threadId: note.message.id, clientId: '4' })
    await settle()
    expect(other.message.threadId).toBe(card.id)
    expect(tasks(c, ch)).toHaveLength(2)
    expect(tasks(c, ch)[1].assigneeId).toBe(b)
    // 在任务结果上开串 = 卡片的串
    const result = texts(c, ch).find(m => m.taskId === card.id && !m.threadId)!
    const onResult = await c.post(ch, { text: '结果收到', threadId: result.id, clientId: '6' })
    expect(onResult.message.threadId).toBe(card.id)
    // 别处来的串 id 不认
    const stray = await c.post(ch, { text: '随便说一句', threadId: 'nope', clientId: '5' })
    expect(stray.message.threadId).toBeUndefined()
  })

  it('卡片在等你决定时，串里不 @ 的话就是回答：交给负责人开下一轮、记「已交给」；回过之后再说只是留言（§3.1）', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改登录页', clientId: '1' })
    await settle()
    const card = tasks(c, ch)[0]
    finishLast(c, '改好了。\n\n需要你决定：「记住我」默认勾上吗？')
    await settle()
    expect(tasks(c, ch)[0]).toMatchObject({ status: 'done', decision: '「记住我」默认勾上吗？' })

    const answer = await c.post(ch, { text: '默认不勾', threadId: card.id, clientId: '2' })
    await settle()
    expect(answer.tasks).toEqual([card.id])
    expect(answer.message.handed).toEqual({ memberId: a, round: 2 })
    expect(sends()).toHaveLength(2)
    expect(sends()[1].sessionId).toBe(sends()[0].sessionId)
    expect(tasks(c, ch)[0]).toMatchObject({ round: 2, decision: null })

    finishLast(c, '按你说的改好了')
    await settle()
    const thanks = await c.post(ch, { text: '辛苦了', threadId: card.id, clientId: '3' })
    expect(thanks.tasks).toEqual([])
    expect(thanks.message.handed).toBeUndefined()
    expect(sends()).toHaveLength(2)
  })
})

describe('频道工具（§1）', () => {
  it('本机成员：提示词只带最近 5 条并说明工具；SSH 机器上的成员和没开工具时照旧带 20 条', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const r = await c.saveMember(null, agent('构建', { projectId: 'ssh-ab~p2' }))
    const ch = await c.create({ name: 'web', memberIds: [a, r] })
    for (let i = 0; i < 8; i++) await c.post(ch, { text: `第 ${i} 句`, clientId: `m${i}` })
    await c.post(ch, { text: '@前端 @构建 开工', clientId: 'go' })
    await settle()
    const [local, remote] = sends()
    expect(local.text).toContain('你有频道工具（MCP 服务 pixelsky_channel）')
    expect(local.text).toContain('第 7 句')
    expect(local.text).not.toContain('第 2 句')
    expect(remote.text).not.toContain('pixelsky_channel')
    expect(remote.text).toContain('第 0 句')
    expect(c.sessionMember(local.sessionId)).toEqual({ memberId: a, tools: null })
    expect(c.sessionMember(remote.sessionId)).toBeNull()
    expect(c.sessionMember('other')).toBeNull()
  })

  it('channel_read 翻页、channel_reply 发在这项活的串里、thread_read 读串；不是频道会话时报错', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    for (let i = 0; i < 5; i++) await c.post(ch, { text: `第 ${i} 句`, clientId: `m${i}` })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    const card = tasks(c, ch)[0]

    const last = c.toolRead(s, { limit: 2 })
    expect(last).toContain('林夏：@前端 改按钮')
    expect(last).toContain('[任务卡 id=' + card.id)
    expect(last).not.toContain('第 4 句')
    const firstId = texts(c, ch)[1].id
    const page = c.toolRead(s, { before: firstId })
    expect(page).toContain('第 0 句')
    expect(page).toContain('前面没有了')

    const unread = () => c.state().channels.find(x => x.id === ch)!.unread
    const before = unread()
    expect(await c.toolReply(s, '先改「账号」页')).toContain('改按钮')
    // AI 在串里的话不刷未读
    expect(unread()).toBe(before)
    const reply = texts(c, ch).at(-1)!
    expect(reply).toMatchObject({ authorId: a, threadId: card.id, format: 'markdown', mentions: [] })
    // 串里的话不上主时间线的读取
    expect(c.toolRead(s, {})).not.toContain('先改「账号」页')
    expect(c.toolThread(s)).toContain('前端：先改「账号」页')
    expect(c.toolRead(s, {})).toContain('串里 1 条')

    expect(() => c.toolRead('other', {})).toThrow('不是频道派活的会话')
    await expect(c.toolReply(s, '  ')).rejects.toThrow('不能为空')
  })

  it('成员被移出频道：正在做的这一轮照常能用工具，这一轮结束后会话被拒', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('文档'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId

    await c.removeMember(ch, a)
    expect(c.sessionMember(s)).toEqual({ memberId: a, tools: null })
    expect(c.toolRead(s, {})).toContain('改按钮')

    finishLast(c, '改好了')
    await settle()
    expect(c.sessionMember(s)).toBeNull()
    expect(() => c.toolRead(s, {})).toThrow('不是频道派活的会话')
  })

  it('task_propose 发提议卡（@你），点「派出去」才派，派活人是你；不要了就不派；名字不对报可选的成员', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('文档'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    await expect(c.toolPropose(s, '后端', '改接口')).rejects.toThrow('可以选：文档')
    await expect(c.toolPropose(s, '前端', '改接口')).rejects.toThrow('不能交给你自己')

    expect(await c.toolPropose(s, '@文档', '更新 README 截图')).toContain('等用户决定')
    const proposal = texts(c, ch).at(-1)!
    expect(proposal).toMatchObject({
      authorId: a,
      mentions: [SELF_ID],
      proposal: { assigneeId: b, request: '更新 README 截图', state: 'open' },
    })
    expect(tasks(c, ch)).toHaveLength(1)

    const taskId = await c.proposal(ch, proposal.id, true)
    await settle()
    expect(tasks(c, ch)[1]).toMatchObject({ id: taskId, authorId: SELF_ID, assigneeId: b, title: '更新 README 截图' })
    expect(sends().at(-1)!.text).toContain('这次的要求：\n更新 README 截图')
    expect(texts(c, ch).find(m => m.id === proposal.id)?.proposal).toMatchObject({ state: 'sent', taskId })
    // 再点不重复派
    expect(await c.proposal(ch, proposal.id, true)).toBe(taskId)
    expect(tasks(c, ch)).toHaveLength(2)

    await c.toolPropose(s, '文档', '顺便改 CHANGELOG')
    const second = texts(c, ch).at(-1)!
    expect(await c.proposal(ch, second.id, false)).toBeNull()
    expect(texts(c, ch).at(-1)?.proposal?.state).toBe('dismissed')
    expect(tasks(c, ch)).toHaveLength(2)
  })

  it('task_handover：没开互相派活时报错；开了直接交出去，算接力；回复里再 @ 同一个人不重复派', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    await expect(c.toolHandover(s, '审查员', '看一下')).rejects.toThrow('task_propose')

    await c.update(ch, { relay: true })
    expect(await c.toolHandover(s, '审查员', '先看一下样式')).toContain('已交给 审查员')
    await settle()
    const [orig, relay] = tasks(c, ch)
    expect(relay).toMatchObject({ authorId: a, assigneeId: b, relay: { chain: orig.id, hop: 1, held: null } })
    expect(texts(c, ch).at(-1)).toMatchObject({ authorId: a, threadId: orig.id, mentions: [b] })
    const handed = sends().at(-1)!
    expect(handed.text).toContain('前端 在做「改按钮」，把这部分交给了你。')
    expect(handed.text).not.toContain('的回复：')
    await expect(c.toolHandover(s, '审查员', '再看')).rejects.toThrow('已经交给过')

    // 前端做完，回复里又 @ 了审查员：已经交过，不再开卡
    const frontSend = sends().find(x => x.sessionId === s)!
    const turn = `turn-${frontSend.clientMessageId}`
    c.hostEvent(
      ev(s, {
        type: 'item_completed',
        item: { kind: 'user', id: frontSend.clientMessageId, text: '', createdAt: 0, turnId: turn },
      }),
    )
    c.hostEvent(
      ev(s, {
        type: 'item_completed',
        item: { kind: 'assistant', id: 'a1', text: '改好了。\n\n@审查员 看一下', status: 'completed' },
      }),
    )
    c.hostEvent(ev(s, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
    await settle()
    expect(tasks(c, ch)).toHaveLength(2)
  })

  it('同一轮里并发调 task_handover：同一成员只开一张卡，交给不同成员的记录和回复计数都不丢', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const d = await c.saveMember(null, agent('文档'))
    const ch = await c.create({ name: 'web', memberIds: [a, b, d] })
    await c.update(ch, { relay: true })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    const results = await Promise.allSettled([
      c.toolHandover(s, '审查员', '看样式'),
      c.toolHandover(s, '审查员', '看样式'),
      c.toolHandover(s, '文档', '补说明'),
      c.toolReply(s, '进展'),
    ])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
    expect((results[1] as PromiseRejectedResult).reason.message).toContain('已经交给过')
    await settle()
    const [orig, ...rest] = tasks(c, ch)
    expect(rest.map(t => t.assigneeId)).toEqual([b, d])
    const runs = (c as unknown as { store: ChannelStore }).store.runs
    expect(runs.get(orig.id)?.tools).toEqual({ replies: 1, proposals: 0, handover: [b, d] })
  })

  it('事项文字里的 @成员、@全体 不多派：只交给选的负责人', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.dispatchIssue(ch, { id: 'i1', title: '支持 @全体 的显示', note: '字面文本 @审查员', memberId: a })
    await settle()
    expect(tasks(c, ch).map(t => t.assigneeId)).toEqual([a])
    expect(sends()).toHaveLength(1)
  })
})

describe('成员的扩展设置（§5）', () => {
  it('只用这些：去重存下 id，乱写当跟随全局；频道会话按成员给出；从已有会话加入的成员不筛', async () => {
    const c = await open()
    const a = await c.saveMember(
      null,
      agent('前端', { tools: { mode: 'only', ids: ['mcp-1', 'skill-2', 'mcp-1', 3 as unknown as string] } }),
    )
    const b = await c.saveMember(null, agent('文档', { tools: { mode: 'all' } as unknown as AgentInput['tools'] }))
    const members = c.state().members
    expect(members.find(m => m.id === a)).toMatchObject({
      config: { tools: { mode: 'only', ids: ['mcp-1', 'skill-2'] } },
    })
    const docs = members.find(m => m.id === b)
    expect(docs?.kind === 'agent' && docs.config?.tools).toBeUndefined()

    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    expect(c.sessionMember(sends()[0].sessionId)).toEqual({
      memberId: a,
      tools: { mode: 'only', ids: ['mcp-1', 'skill-2'] },
    })

    // 改回跟随全局
    await c.saveMember(null, { ...agent('前端'), id: a, tools: null })
    expect(c.sessionMember(sends()[0].sessionId)).toEqual({ memberId: a, tools: null })
  })

  it('头像（channels-side-panels §3.3）：合法的存下，乱写的丢掉，编辑不带不清掉，改头像不清共用会话', async () => {
    const c = await open()
    const avatarOf = (id: string) => c.state().members.find(m => m.id === id)
    const a = await c.saveMember(
      null,
      agent('前端', { mode: 'shared', avatar: { style: 'icon', color: 'blue', icon: 'skull' } }),
    )
    expect(avatarOf(a)).toMatchObject({
      avatar: { style: 'icon', color: 'blue' },
      config: { avatar: { style: 'icon' } },
    })
    expect(avatarOf(a)).not.toHaveProperty('avatar.icon')
    const b = await c.saveMember(
      null,
      agent('文档', { avatar: { style: 'photo', color: 'blue' } as unknown as AgentInput['avatar'] }),
    )
    expect(avatarOf(b)).toMatchObject({ avatar: null })

    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const shared = c.state().members.find(m => m.id === a)
    const session = shared?.kind === 'agent' ? shared.config?.sharedSessionId : null
    expect(session).toBeTruthy()

    // 编辑对话框不带头像：沿用
    await c.saveMember(null, { ...agent('前端', { mode: 'shared' }), id: a })
    expect(avatarOf(a)).toMatchObject({ avatar: { style: 'icon', color: 'blue' } })
    // 换头像：共用会话还在
    await c.saveMember(null, {
      ...agent('前端', { mode: 'shared' }),
      id: a,
      avatar: { style: 'pixel', color: 'gray', seed: 2 },
    })
    expect(avatarOf(a)).toMatchObject({ avatar: { style: 'pixel', seed: 2 }, config: { sharedSessionId: session } })
    // null 清掉
    await c.saveMember(null, { ...agent('前端', { mode: 'shared' }), id: a, avatar: null })
    expect(avatarOf(a)).toMatchObject({ avatar: null })
  })

  it('频道的 load：一个成员在两个频道里，只有派了活的那个频道有它', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const web = await c.create({ name: 'web', memberIds: [a] })
    const docs = await c.create({ name: 'docs', memberIds: [a] })
    const loadOf = (id: string) => c.state().channels.find(x => x.id === id)?.load
    expect(loadOf(web)).toEqual({})
    await c.post(web, { text: '@前端 改按钮', clientId: 'go' })
    await c.post(web, { text: '@前端 再改个颜色', clientId: 'go2' })
    await settle()
    expect(loadOf(web)).toEqual({ [a]: { running: true, waiting: false, queued: 1 } })
    expect(loadOf(docs)).toEqual({})
  })

  it('没开频道工具（测试 / 旧接线）：会话不算频道会话，提示词照旧', async () => {
    const c = await open(false)
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    expect(sends()[0].text).not.toContain('pixelsky_channel')
    expect(c.sessionMember(sends()[0].sessionId)).toBeNull()
  })
})

describe('产出检查（§8）', () => {
  const failed: CheckRun = {
    id: 'r1',
    at: 1,
    status: 'done',
    items: [
      {
        kind: 'command',
        label: 'test',
        command: 'pnpm run test',
        status: 'fail',
        exitCode: 1,
        ms: 5,
        output: 'x.test.ts 失败',
      },
    ],
  }

  it('卡片做完后跑检查：先显示检查中，跑完写上结果；「让它修」把失败输出当追加要求发回同一个会话，新一轮清掉旧结果', async () => {
    let release!: (run: CheckRun | null) => void
    const asked: { sessionId: string; files: string[] }[] = []
    const c = await open(true, {
      runChecks: (sessionId, files) => {
        asked.push({ sessionId, files })
        return new Promise(r => (release = r))
      },
    })
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    finishLast(c, '改好了')
    await settle()
    expect(asked).toEqual([{ sessionId: sends()[0].sessionId, files: [] }])
    expect(tasks(c, ch)[0].checks?.status).toBe('running')
    release(failed)
    await settle()
    expect(tasks(c, ch)[0].checks).toEqual(failed)

    await c.taskAction(tasks(c, ch)[0].id, 'fix')
    await settle()
    const fix = sends().at(-1)!
    expect(fix.sessionId).toBe(sends()[0].sessionId)
    expect(fix.text).toContain('pnpm run test')
    expect(fix.text).toContain('x.test.ts 失败')
    expect(tasks(c, ch)[0]).toMatchObject({ round: 2, checks: null })
  })

  it('项目关了频道检查（返回 null）就不留结果；没过的检查才能「让它修」；重启后「检查中」清掉', async () => {
    const c = await open(true, { runChecks: async () => null })
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    finishLast(c, '改好了')
    await settle()
    expect(tasks(c, ch)[0].checks).toBeNull()
    await c.taskAction(tasks(c, ch)[0].id, 'fix')
    expect(sends()).toHaveLength(1)

    let hold!: () => void
    const d = await open(true, { runChecks: () => new Promise(r => (hold = () => r(null))) })
    await d.post(ch, { text: '@前端 再改一下', clientId: 'go2' })
    await settle()
    finishLast(d, '好了')
    await settle()
    expect(tasks(d, ch).at(-1)?.checks?.status).toBe('running')
    await (d as unknown as { store: ChannelStore }).store.flush()
    const e = await open(true)
    expect(tasks(e, ch).at(-1)?.checks).toBeNull()
    hold()
  })
})

describe('主动提醒（§6）', () => {
  const MIN = 60_000
  const request = (id: string, command: string) => ({
    type: 'approval_request' as const,
    request: { requestId: id, itemId: null, kind: 'command' as const, title: '运行命令', command, alwaysScopes: [] },
  })
  const alerts = (c: Channels, ch: string) => texts(c, ch).filter(m => m.alert)

  it('等你回答超过 10 分钟提醒一次（同一个请求不重复）；回答后提醒标为处理过；进「需要你」', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0]
    c.hostEvent(
      ev(s.sessionId, {
        type: 'item_completed',
        item: { kind: 'user', id: s.clientMessageId, text: '', createdAt: 0, turnId: 't' },
      }),
    )
    c.hostEvent(ev(s.sessionId, request('r1', 'pnpm add zod')))
    expect(tasks(c, ch)[0].status).toBe('waiting')
    await c.checkAlerts()
    now += 11 * MIN
    await c.checkAlerts()
    await c.checkAlerts()
    expect(alerts(c, ch)).toHaveLength(1)
    expect(alerts(c, ch)[0]).toMatchObject({
      authorId: 'system',
      mentions: [SELF_ID],
      alert: { rule: 'waiting', state: 'open', taskId: tasks(c, ch)[0].id, sig: 'r1' },
    })
    expect(c.state().needs?.map(n => n.kind)).toEqual(['alert', 'approval'])
    c.hostEvent(ev(s.sessionId, { type: 'approval_resolved', requestId: 'r1' } as never))
    c.hostEvent(
      ev(s.sessionId, {
        type: 'item_started',
        item: { kind: 'assistant', id: 'x', text: '', status: 'in_progress' },
      } as never),
    )
    await c.checkAlerts()
    expect(alerts(c, ch)[0].alert?.state).toBe(tasks(c, ch)[0].status === 'waiting' ? 'open' : 'done')
  })

  it('「没进展」按频道设的分钟数提醒：设成 5 分钟，6 分钟没动静就提醒；旧频道按 15 分钟', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    expect(c.state().channels.find(x => x.id === ch)).toMatchObject({ maxRejects: 3, stalledMinutes: 15 })
    await c.update(ch, { stalledMinutes: 5, maxRejects: 99 })
    // 不认识的值悄悄回到默认
    expect(c.state().channels.find(x => x.id === ch)).toMatchObject({ maxRejects: 3, stalledMinutes: 5 })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0]
    c.hostEvent(
      ev(s.sessionId, {
        type: 'item_completed',
        item: { kind: 'user', id: s.clientMessageId, text: '', createdAt: 0, turnId: 't' },
      }),
    )
    await c.checkAlerts()
    now += 6 * MIN
    await c.checkAlerts()
    const stalled = alerts(c, ch).filter(m => m.alert?.rule === 'stalled')
    expect(stalled).toHaveLength(1)
    expect(stalled[0].text).toContain('5 分钟')
  })

  it('同一目录另一项活在做时，要审批的 git checkout 提醒「先暂停它」：点了就拒绝这个请求；不同目录不提醒', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const r = await c.saveMember(null, agent('构建', { projectId: 'ssh-ab~p2' }))
    const ch = await c.create({ name: 'web', memberIds: [a, b, r] })
    await c.post(ch, { text: '@前端 改按钮', clientId: '1' })
    await c.post(ch, { text: '@审查员 看看', clientId: '2' })
    await c.post(ch, { text: '@构建 打包', clientId: '3' })
    await settle()
    const [fa, , fr] = sends()
    for (const x of [fa, fr])
      c.hostEvent(
        ev(x.sessionId, {
          type: 'item_completed',
          item: { kind: 'user', id: x.clientMessageId, text: '', createdAt: 0, turnId: 't' },
        }),
      )
    c.hostEvent(ev(fr.sessionId, request('rr', 'git checkout -- .')))
    expect(alerts(c, ch)).toHaveLength(0)
    c.hostEvent(ev(fa.sessionId, request('ra', 'git checkout -- src/a.ts')))
    await settle()
    const [alert] = alerts(c, ch)
    expect(alert.alert).toMatchObject({ rule: 'conflict', state: 'open', sig: 'ra' })
    expect(alert.text).toContain('审查员')
    await c.alertAction(ch, alert.id, 'hold')
    expect(calls.find(x => x.channel === 'engine:answer')?.args).toEqual([fa.sessionId, 'ra', { type: 'deny' }])
    expect(alerts(c, ch)[0].alert?.state).toBe('done')
  })

  it.each(['full', 'auto'] as const)(
    '%s 权限的成员直接跑会丢改动的命令：中断这一轮并提醒；关了这条规则就不管',
    async mode => {
      const c = await open()
      const a = await c.saveMember(null, agent('前端', { settings: { permissionMode: mode } }))
      const b = await c.saveMember(null, agent('审查员'))
      const ch = await c.create({ name: 'web', memberIds: [a, b] })
      await c.post(ch, { text: '@前端 改按钮', clientId: '1' })
      await c.post(ch, { text: '@审查员 看看', clientId: '2' })
      await settle()
      const fa = sends()[0]
      c.hostEvent(
        ev(fa.sessionId, {
          type: 'item_completed',
          item: { kind: 'user', id: fa.clientMessageId, text: '', createdAt: 0, turnId: 'tt' },
        }),
      )
      const started = (id: string) =>
        ev(fa.sessionId, {
          type: 'item_started',
          item: {
            kind: 'command',
            id,
            command: 'git reset --hard',
            description: null,
            output: '',
            exitCode: null,
            status: 'in_progress',
          },
        } as never)
      c.hostEvent(started('c1'))
      await settle()
      expect(calls.find(x => x.channel === 'engine:interruptTurn')?.args).toEqual([fa.sessionId, 'tt'])
      expect(alerts(c, ch)[0].alert).toMatchObject({ rule: 'conflict', sig: 'c1' })
      await c.update(ch, { alerts: { conflict: false } })
      c.hostEvent(started('c2'))
      await settle()
      expect(alerts(c, ch)).toHaveLength(1)
    },
  )

  it('@ 了没人接（规则打开时）：排队超过 10 分钟提醒，「换人」取消这项活并给出草稿；每日简报到点发一次', async () => {
    // 简报按本地钟点算：从某天上午 10 点开始
    now = new Date(2026, 9, 22, 10, 0).getTime()
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.update(ch, { alerts: { unclaimed: true, digest: true }, digestHour: 9 })
    await c.post(ch, { text: '@前端 第一项', clientId: '1' })
    await c.post(ch, { text: '@前端 第二项', clientId: '2' })
    await settle()
    finishLast(c, '第一项做完了')
    // 第二项接着开始了：让第三项排队
    await c.post(ch, { text: '@前端 第三项', clientId: '3' })
    await settle()
    now += 11 * MIN
    await c.checkAlerts()
    const unclaimed = alerts(c, ch).find(m => m.alert?.rule === 'unclaimed')!
    expect(unclaimed.text).toContain('第三项')
    const { draft } = await c.alertAction(ch, unclaimed.id, 'reassign')
    expect(draft).toBe('@ 第三项')
    expect(tasks(c, ch).find(t => t.title === '第三项')?.status).toBe('stopped')

    // 简报：把时间拨到第二天 9 点之后
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(9, 30, 0, 0)
    now = next.getTime()
    await c.checkAlerts()
    await c.checkAlerts()
    const digests = alerts(c, ch).filter(m => m.alert?.rule === 'digest')
    expect(digests).toHaveLength(1)
    expect(digests[0].text).toContain('每日简报')
    expect(digests[0].mentions).toEqual([])
    // 发完把钟点改晚：当天不再发第二次
    await c.update(ch, { digestHour: 18 })
    now += 9 * 60 * MIN
    await c.checkAlerts()
    expect(alerts(c, ch).filter(m => m.alert?.rule === 'digest')).toHaveLength(1)
  })
})

describe('事项（§9）', () => {
  it('交给成员：@ 他派一张卡，卡上记着事项；卡片的状态和检查合并后写回事项，检查跑完才进待验收；打回 = 串里追加要求', async () => {
    let release!: (run: CheckRun | null) => void
    const synced: {
      id: string
      input: { link: { state: string; taskId: string; checks?: unknown }; status?: string; fresh?: boolean }
    }[] = []
    const c = await open(true, {
      runChecks: () => new Promise(r => (release = r)),
      syncIssue: async (id, input) => {
        synced.push({ id, input })
      },
    })
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await expect(c.dispatchIssue(ch, { id: 'i1', title: '登录页', memberId: 'nobody' })).rejects.toThrow('不在频道里')
    const { taskId } = await c.dispatchIssue(ch, {
      id: 'i1',
      title: '登录页',
      note: '按设计稿改',
      memberId: a,
      acceptance: ['能登录', ' ', '有错误提示'],
    })
    // 返回时事项上已经写好这张卡
    expect(synced.map(x => x.input.link.taskId)).toEqual([taskId])
    const card = tasks(c, ch)[0]
    expect(card).toMatchObject({ id: taskId, assigneeId: a, issue: { id: 'i1', title: '登录页' } })
    expect(texts(c, ch)[0].text).toBe('@前端 事项：登录页\n\n按设计稿改\n\n验收标准：\n1. 能登录\n2. 有错误提示')
    await settle()
    expect(sends()[0].text).toContain('1. 能登录')
    await new Promise(r => setTimeout(r, 350))
    // 派出时马上写回一次（看板上不会再点出第二张卡），之后的变化合并后写
    expect(synced[0]).toMatchObject({ id: 'i1', input: { status: 'in_progress', fresh: true, link: { taskId } } })
    expect(synced.at(-1)).toMatchObject({ id: 'i1', input: { status: 'in_progress', fresh: false } })

    finishLast(c, '改好了')
    await settle()
    await new Promise(r => setTimeout(r, 350))
    // 做完紧接着开始检查：还是进行中
    expect(synced.at(-1)!.input).toMatchObject({
      status: 'in_progress',
      link: { state: 'done', checks: { status: 'running' } },
    })
    release({ id: 'r', at: 1, status: 'done', items: [] })
    await settle()
    await new Promise(r => setTimeout(r, 350))
    expect(synced.at(-1)!.input).toMatchObject({
      status: 'review',
      fresh: false,
      link: { checks: { status: 'pass', problems: 0 } },
    })

    // 打回：在卡片的串里 @ 同一个成员 = 追加要求，事项回到进行中
    await c.post(ch, { text: '@前端 验收没通过：按钮颜色不对', threadId: taskId, clientId: 'rej' })
    await settle()
    await new Promise(r => setTimeout(r, 350))
    expect(tasks(c, ch)[0].round).toBe(2)
    expect(synced.at(-1)!.input).toMatchObject({ status: 'in_progress', link: { taskId, round: 2 } })
  })
})
