function route(msg, config, threads) {
  if (msg.authorIsBot || msg.isWebhook) return {action: 'ignore'};
  if (!msg.threadId) {
    const botId = config.channels.get(msg.channelId);
    const triggered = msg.mentionsMe || config.withoutMention?.has(msg.channelId);
    return botId && triggered ? {action: 'start', botId} : {action: 'ignore'};
  }

  const entry = threads.get(msg.threadId);
  const botId = config.channels.get(entry?.channelId);
  if (!entry || !botId || entry.channelId !== msg.parentId) return {action: 'ignore'};
  if (entry.state !== 'idle') return {action: 'busy', state: entry.state};
  // Native tasks belong to the agent that created them.
  const taskId = entry.botId && entry.botId !== botId ? 'new' : entry.taskId;
  return {action: 'continue', botId, taskId};
}

const statuses = {
  es: {
    typing: 'Escribiendo…',
    attachmentOnly: 'Te envío estos archivos.',
    attachmentRejected: 'No pude recibir uno o más adjuntos. Podés enviar hasta 5 archivos, con 10 MB por imagen y 25 MB en total. Revisá el formato y volvé a intentar.',
    replyAttachmentRejected: 'No pude adjuntar uno o más archivos de la respuesta. Discord acepta hasta 10 archivos por mensaje, de hasta 10 MB cada uno.',
    needsInput: 'El agente está esperando una respuesta en el panel.',
    timeout: 'Sigue trabajando; lo dejo corriendo.',
    failed: 'Algo falló; revisá el panel.',
  },
  en: {
    typing: 'Typing…',
    attachmentOnly: 'I am sending these files.',
    attachmentRejected: 'I could not receive one or more attachments. You can send up to 5 files, with 10 MB per image and 25 MB in total. Check the format and try again.',
    replyAttachmentRejected: 'I could not attach one or more files to the reply. Discord accepts up to 10 files per message, up to 10 MB each.',
    needsInput: 'The agent is waiting for an answer in the panel.',
    timeout: "Still working; I'll leave it running.",
    failed: 'Something failed; check the panel.',
  },
};

function statusText(kind, language) {
  return statuses[language][kind];
}

function outcome(result) {
  const text = result?.reply?.text;
  if (result?.exitCode === 0 && typeof text === 'string' && text.trim()) {
    return {text, kind: 'reply', state: 'idle'};
  }
  if (result?.exitCode === 3) return {text: null, kind: 'needsInput', state: 'waiting'};
  if (result?.exitCode === 4) return {text: null, kind: 'timeout', state: 'working'};
  return {text: null, kind: 'failed', state: 'idle'};
}

module.exports = {route, statusText, outcome};
