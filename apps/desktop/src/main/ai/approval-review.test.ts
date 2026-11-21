import { afterEach, expect, it, vi } from 'vitest'
import type { ApprovalRequest, SessionRecord } from '@pixelsky/protocol'
import type { AppContext } from '../app/context'
import { platformFetch } from '../account/account'
import { reviewEngineApproval } from './approval-review'

vi.mock('../account/account', () => ({ platformFetch: vi.fn(), signedInEmail: () => 'owner@example.org' }))
vi.mock('../platform/platform', () => ({ platformPixelApi: () => 'openai-responses' }))
const request: ApprovalRequest = {
  requestId: 'test',
  itemId: null,
  kind: 'command',
  title: '运行命令',
  command: 'echo hi',
  alwaysScopes: [],
}
const model = 'review-model'
function setup(engine: SessionRecord['engine']) {
  const oneShot = vi.fn().mockResolvedValue({ text: '{"decision":"allow"}' })
  const resolve = vi.fn()
  const ctx = {
    engine: { engineConfig: () => ({ codex: { autoReviewModel: model } }), oneShot },
    providers: { resolve },
  } as unknown as AppContext
  const session = { engine, permissionMode: 'auto' } as SessionRecord
  return { ctx, session, oneShot, resolve }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each(['pixel', 'antigravity'] as const)('uses the shared model with the local %s account', async engine => {
  const { ctx, session, oneShot } = setup(engine)
  expect(await reviewEngineApproval(ctx, session, request)).toBe('allow')
  expect(oneShot).toHaveBeenCalledWith(engine, expect.objectContaining({ model }), expect.any(AbortSignal))
  expect(platformFetch).not.toHaveBeenCalled()
})

it('Pi 的 OpenAI 平台线路使用 Responses 协议和原分组', async () => {
  const { ctx, session } = setup('pixel')
  session.platform = { account: 'owner@example.org', groupId: '25' }
  vi.mocked(platformFetch).mockResolvedValue(Response.json({ output_text: '{"decision":"deny"}', status: 'completed' }))
  expect(await reviewEngineApproval(ctx, session, request)).toBe('deny')
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
  expect(await reviewEngineApproval(ctx, session, request)).toBe('allow')
  expect(fetch).toHaveBeenCalledWith(
    'https://unit.test/v1beta/models/review-model:generateContent',
    expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'test' }),
      redirect: 'error',
    }),
  )
  expect(await reviewEngineApproval(ctx, session, request)).toBeNull()
})
