function route(msg, config, threads) {
  if (msg.authorIsBot || msg.isWebhook) return {action: 'ignore'};
  if (!msg.threadId) {
    const botId = config.channels.get(msg.channelId);
    return botId && msg.mentionsMe ? {action: 'start', botId} : {action: 'ignore'};
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
    needsInput: 'El agente está esperando una respuesta en el panel.',
    timeout: 'Sigue trabajando; lo dejo corriendo.',
    failed: 'Algo falló; revisá el panel.',
  },
  en: {
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
