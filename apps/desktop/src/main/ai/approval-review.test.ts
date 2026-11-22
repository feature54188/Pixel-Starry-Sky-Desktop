import { afterEach, expect, it, vi } from 'vitest'
import type { ApprovalRequest, SessionRecord } from '@pixelsky/protocol'
import type { AppContext } from '../app/context'
import { platformFetch } from '../account/account'
import { reviewEngineApproval } from './approval-review'

vi.mock('../account/account', () => ({ platformFetch: vi.fn(), signedInEmail: () => 'owner@example.org' }))
vi.mock('../platform/platform', () => ({
  platformPixelApi: () => 'openai-responses',
  routeModels: vi.fn().mockResolvedValue(['gpt-5', 'claude-sonnet-4-6']),
}))
const request: ApprovalRequest = {
  requestId: 'test',
  itemId: null,
  kind: 'command',
  title: '运行命令',
  command: 'echo hi',
  alwaysScopes: [],
}
const model = 'review-model'
function setup(engine: SessionRecord['engine'], reviewModel: string | null = model) {
  const oneShot = vi.fn().mockResolvedValue({ text: '{"decision":"allow"}' })
  const resolve = vi.fn()
  const ctx = {
    engine: { engineConfig: () => ({ codex: { autoReviewModel: reviewModel } }), oneShot },
    providers: { resolve },
  } as unknown as AppContext
  const session = { engine, permissionMode: 'auto' } as SessionRecord
  return { ctx, session, oneShot, resolve }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('本机审核仅收到打码后的任务和操作，按连续字符长度处理边界', async () => {
  const { ctx, session, oneShot } = setup('claude', null)
  const short64 = 'Zg+/'.repeat(8)
  const long64 = short64 + 'Z'
  const url64 = 'g_7-'.repeat(9)
  const userText = ['12abCDef', '12abCDef0', short64, long64, url64, 'zz123456789zz'].join('\n')
  const expected = ['12abCDef', '**mask**', short64, '**mask**', '**mask**', 'zz**mask**zz'].join('\n')
  const operation = { ...request, command: 'echo "' + userText + '"' }
  await reviewEngineApproval(ctx, session, operation, userText)
  const prompt = oneShot.mock.calls[0][1].prompt as string
  expect(prompt).toContain(JSON.stringify(expected))
  expect(prompt).toContain(JSON.stringify('echo "' + expected + '"'))
  for (const secret of ['12abCDef0', long64, url64, '123456789']) expect(prompt).not.toContain(secret)
  expect(operation.command).toContain(long64)
})

it('送往接口的审核请求会打码嵌套字段和值，Base64 计入末尾填充', async () => {
  const { ctx, session } = setup('claude', 'gpt-5')
  session.platform = { account: 'owner@example.org', groupId: '25' }
  vi.mocked(platformFetch).mockResolvedValue(Response.json({ output_text: '{"decision":"deny"}' }))
  const atLimit = 'Z'.repeat(30) + '=='
  const aboveLimit = 'Z'.repeat(34) + '=='
  const field = 'g'.repeat(33)
  const operation = { ...request, input: { [field]: [atLimit, aboveLimit, 'A0123bC45'] } }
  expect(await reviewEngineApproval(ctx, session, operation, '检查 ' + aboveLimit)).toBe('deny')
  const { input } = JSON.parse(vi.mocked(platformFetch).mock.calls[0][1]!.body as string)
  expect(input).toContain(JSON.stringify({ '**mask**': [atLimit, '**mask**', '**mask**'] }))
  expect(input).toContain('检查 **mask**')
  for (const secret of [field, aboveLimit, 'A0123bC45']) expect(input).not.toContain(secret)
})

it('Claude 本机自动审核默认跟随会话模型，能读到代码块中的明确决定', async () => {
  const { ctx, session, oneShot } = setup('claude', null)
  oneShot.mockResolvedValue({ text: '```json\n{"decision":"deny"}\n```' })
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('deny')
  expect(oneShot).toHaveBeenCalledWith('claude', expect.objectContaining({ model: null }), expect.any(AbortSignal))
  session.model = 'sonnet'
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('deny')
  expect(oneShot).toHaveBeenLastCalledWith(
    'claude',
    expect.objectContaining({ model: 'sonnet' }),
    expect.any(AbortSignal),
  )
})

it('Claude 本机会话指定 GPT 审核模型时通过 Codex 调用，引擎失败交给用户', async () => {
  const { ctx, session, oneShot } = setup('claude', 'gpt-5')
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('allow')
  expect(oneShot).toHaveBeenCalledWith('codex', expect.objectContaining({ model: 'gpt-5' }), expect.any(AbortSignal))
  oneShot.mockRejectedValueOnce(new Error('not signed in'))
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBeNull()
  oneShot.mockResolvedValueOnce({ text: 'allow' })
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBeNull()
  session.permissionMode = 'ask'
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBeNull()
  expect(oneShot).toHaveBeenCalledTimes(3)
})

it('Claude 走平台时，指定 GPT 审核走原分组的 Responses 接口', async () => {
  const { ctx, session, oneShot } = setup('claude', 'gpt-5')
  session.platform = { account: 'owner@example.org', groupId: '25' }
  vi.mocked(platformFetch).mockResolvedValue(Response.json({ output_text: '{"decision":"allow"}' }))
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('allow')
  expect(platformFetch).toHaveBeenCalledWith(
    '/v1/platform/responses',
    expect.objectContaining({
      headers: expect.objectContaining({ 'X-PixelSky-Group': '25' }),
      body: expect.stringContaining('"model":"gpt-5"'),
    }),
  )
  expect(oneShot).not.toHaveBeenCalled()
})

it('Claude 自定义线路没有显式模型时，默认使用接口配置的后台模型', async () => {
  const { ctx, session, resolve, oneShot } = setup('claude', null)
  session.provider = { id: 'custom' }
  resolve.mockReturnValue({
    protocol: 'anthropic',
    baseUrl: 'https://unit.test',
    apiKey: 'test',
    headers: {},
    models: [{ id: 'first' }, { id: 'review' }],
    smallModel: 'review',
  })
  const fetch = vi.fn().mockResolvedValue(Response.json({ content: [{ type: 'text', text: '{"decision":"deny"}' }] }))
  vi.stubGlobal('fetch', fetch)
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('deny')
  expect(fetch).toHaveBeenCalledWith(
    'https://unit.test/v1/messages',
    expect.objectContaining({
      body: expect.stringContaining('"model":"review"'),
    }),
  )
  expect(oneShot).not.toHaveBeenCalled()
})

it.each(['pixel', 'antigravity'] as const)('uses the shared model with the local %s account', async engine => {
  const { ctx, session, oneShot } = setup(engine)
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('allow')
  expect(oneShot).toHaveBeenCalledWith(engine, expect.objectContaining({ model }), expect.any(AbortSignal))
  expect(platformFetch).not.toHaveBeenCalled()
})

it('Pi 的 OpenAI 平台线路使用 Responses 协议和原分组', async () => {
  const { ctx, session } = setup('pixel')
  session.platform = { account: 'owner@example.org', groupId: '25' }
  vi.mocked(platformFetch).mockResolvedValue(Response.json({ output_text: '{"decision":"deny"}', status: 'completed' }))
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('deny')
  expect(platformFetch).toHaveBeenCalledWith(
    '/v1/platform/responses',
    expect.objectContaining({
      headers: expect.objectContaining({ 'X-PixelSky-Group': '25' }),
      body: expect.stringContaining('"model":"review-model"'),
    }),
  )
})

it('反重力自定义接口使用 Gemini 协议，截断的结果回退人工', async () => {
  const { ctx, session, resolve } = setup('antigravity')
  session.provider = { id: 'custom' }
  resolve.mockReturnValue({ protocol: 'gemini', baseUrl: 'https://unit.test', apiKey: 'test', headers: {} })
  const parts = [{ thought: true, text: 'thinking' }, { text: '{"decision":"allow"}' }]
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts }, finishReason: 'STOP' }] }))
    .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts }, finishReason: 'MAX_TOKENS' }] }))
  vi.stubGlobal('fetch', fetch)
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBe('allow')
  expect(fetch).toHaveBeenCalledWith(
    'https://unit.test/v1beta/models/review-model:generateContent',
    expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'test' }),
      redirect: 'error',
    }),
  )
  expect(await reviewEngineApproval(ctx, session, request, 'Print hi')).toBeNull()
})
