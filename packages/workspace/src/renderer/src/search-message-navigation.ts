// Retain one navigation request until the destination ChatPanel has mounted.
let pending: { conversationId: string; messageId: string } | undefined
export function requestMessageNavigation(conversationId: string, messageId: string) {
  pending = { conversationId, messageId }
  window.dispatchEvent(new Event('workspace-message-navigation'))
}
export function takeMessageNavigation(conversationId: string) {
  if (pending?.conversationId !== conversationId) return
  const messageId = pending.messageId
  pending = undefined
  return messageId
}
