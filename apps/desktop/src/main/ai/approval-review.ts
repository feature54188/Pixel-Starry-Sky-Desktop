import { randomUUID } from 'node:crypto'
import type { ApprovalRequest, SessionRecord } from '@pixelsky/protocol'
import type { AppContext } from '../app/context'
import { platformFetch, signedInEmail } from '../account/account'
import { oneShotBody, parseReply } from '../core/ai/oneshot'
import { geminiPath, PROTOCOL_PATH, upstreamUrl, providerHeaders } from '../core/providers/upstream'
import { platformPixelApi } from '../platform/platform'

/** 按会话的线路调用共用审核模型。出错时交回人工确认。 */
export async function reviewEngineApproval(
  ctx: AppContext,
  session: SessionRecord,
  request: ApprovalRequest,
): Promise<'allow' | 'deny' | null> {
  const engine = ctx.engine
  const model = engine?.engineConfig().codex.autoReviewModel
  if (!engine || !model || session.permissionMode !== 'auto') return null
  const system = 'Review permissions conservatively. Do not perform the requested operation.'
  const operation = JSON.stringify(request)
  if (operation.length > 16_000) return null
  const prompt = [
    'A coding agent requests permission to perform one operation.',
    'Decide whether this exact operation is safe and clearly within the user’s request.',
    'Deny destructive, exfiltrating, privilege-escalating, unrelated, or ambiguous operations.',
    'Output exactly one JSON object with decision set to allow or deny and a short reason.',
    'Permission request:',
    operation,
  ].join('\n')
  const signal = AbortSignal.timeout(30_000)
  try {
    let text: string
    if (session.platform || session.provider) {
      const route = session.platform
      if (route && route.account !== signedInEmail()) return null
      const provider = !route && session.provider ? ctx.providers?.resolve(session.provider.id) : null
      if (!route && !provider?.apiKey) return null
      const protocol =
        provider?.protocol ??
        (session.engine === 'antigravity'
          ? 'gemini'
          : session.engine === 'pixel' && route && platformPixelApi(route.groupId, model) === 'openai-responses'
            ? 'responses'
            : 'anthropic')
      const body = JSON.stringify(oneShotBody({ protocol, model, system, prompt, maxTokens: 300 }))
      const headers = { 'content-type': 'application/json', accept: 'application/json' }
      let response: Response
      if (route) {
        const path =
          protocol === 'gemini'
            ? '/v1/platform/gemini/models/' + encodeURIComponent(model) + ':generateContent'
            : protocol === 'responses'
              ? '/v1/platform/responses'
              : '/v1/platform/messages'
        response = await platformFetch(path, {
          method: 'POST',
          body,
          signal,
          headers: {
            ...headers,
            'X-PixelSky-Group': route.groupId,
            'X-Client-Request-ID': 'pixelsky-' + randomUUID(),
            ...(protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}),
          },
        })
      } else if (provider) {
        const path = protocol === 'gemini' ? geminiPath(model, 'generateContent') : PROTOCOL_PATH[protocol]
        response = await fetch(upstreamUrl(provider, path), {
          method: 'POST',
          body,
          signal,
          redirect: 'error',
          headers: providerHeaders(provider, headers),
        })
      } else return null
      if (!response.ok) return null
      const reply = parseReply(protocol, await response.json())
      if (reply.truncated) return null
      text = reply.text
    } else {
      const reply = await engine.oneShot(session.engine, { model, prompt: system + '\n\n' + prompt }, signal)
      text = reply.text
    }
    const parsed = JSON.parse(text) as { decision?: unknown }
    return parsed.decision === 'allow' || parsed.decision === 'deny' ? parsed.decision : null
  } catch {
    return null
  }
}
