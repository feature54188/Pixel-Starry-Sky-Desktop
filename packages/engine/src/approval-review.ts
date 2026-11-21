import type { ApprovalRequest } from '@pixelsky/protocol'
import type { SessionContext } from './adapter'

/** 工具请求可以委托给审核模型。计划和提问需要用户回答，已取消的请求丢弃迟到的结果。 */
export function reviewOrAsk(
  ctx: SessionContext,
  request: ApprovalRequest,
  isPending: () => boolean,
  answer: (decision: 'allow' | 'deny') => void,
): void {
  const ask = (): void => ctx.emit({ type: 'approval_request', request })
  if (
    !ctx.reviewApproval ||
    ctx.record().permissionMode !== 'auto' ||
    request.kind === 'plan' ||
    request.kind === 'question'
  ) {
    ask()
    return
  }
  void ctx
    .reviewApproval(request)
    .catch(() => null)
    .then(decision => {
      if (!isPending()) return
      if (decision && ctx.record().permissionMode === 'auto') answer(decision)
      else ask()
    })
}
