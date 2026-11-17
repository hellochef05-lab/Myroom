export function isMessageHidden(message, pendingIds) {
  return !message || message.type === 'deleted' || Boolean(message.deleted_at) ||
    Boolean(pendingIds?.has(message.id));
}

export async function deleteMessageImmediately(message, { setPending, deleteMessage, updateMessage }) {
  setPending(message.id, true);
  try {
    const deleted = await deleteMessage(message);
    updateMessage(deleted);
  } finally {
    setPending(message.id, false);
  }
}
