const {execFile} = require('node:child_process');
const {validId} = require('./config.cjs');

function projectPort(port) {
  const value = String(port);
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw Error('FYSO_OMB_PORT must be an integer from 1 to 65535');
  }
  return value;
}

function requireId(id) {
  if (!validId(id)) throw Error('Invalid OpenMausBot ID');
}

function invoke(bin, args, {text, timeout}) {
  const env = {...process.env};
  delete env.DISCORD_BOT_TOKEN;
  // The port must select the project even if a caller also exported a desktop URL.
  delete env.OPENMAUSBOT_URL;
  return new Promise(resolve => {
    const child = execFile(bin, args, {maxBuffer: 4 * 1024 * 1024, timeout, env},
      (error, stdout) => {
        const exitCode = Number.isInteger(error?.code) ? error.code : error ? 1 : 0;
        try {
          const value = JSON.parse(stdout);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
          resolve({exitCode, value});
        } catch {
          resolve({exitCode: 1});
        }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}

async function runAgent({botId, taskId, text, port, bin = 'openmausbot'}) {
  requireId(botId);
  requireId(taskId);
  const {exitCode, value} = await invoke(bin, [
    'run', '--bot', botId, '-', '--port', projectPort(port), '--json', '--task', taskId,
    '--timeout', '30m', '--on-input', 'exit', '--on-timeout', 'leave',
  ], {text, timeout: 31 * 60_000});
  const result = {exitCode};
  if (validId(value?.threadId)) result.threadId = value.threadId;
  if (Number.isSafeInteger(value?.since) && value.since > 0) result.since = value.since;
  if (typeof value?.reply?.text === 'string') {
    result.reply = {text: value.reply.text};
    // The final reply is the last non-blank bot text message, as OpenMausBot picks it.
    const final = Array.isArray(value.messages) && value.messages.findLast(message => message?.role === 'bot' &&
      message.kind === 'text' && typeof message.text === 'string' && message.text.trim());
    if (/^[A-Za-z0-9_-]{1,128}$/.test(final?.id)) result.reply.id = final.id;
    result.reply.files = Array.isArray(value.reply.files)
      ? value.reply.files.filter(file => typeof file === 'string' && file.length <= 1024).slice(0, 10) : [];
  }
  return result;
}

async function waitForTurn({taskId, port, since, bin = 'openmausbot'}) {
  requireId(taskId);
  if (since !== undefined && (!Number.isSafeInteger(since) || since <= 0)) throw Error('Invalid turn timestamp');
  const {exitCode, value} = await invoke(bin, [
    'wait', '--thread', taskId, '--port', projectPort(port), '--json',
    '--timeout', '5s', '--on-input', 'exit', '--on-timeout', 'leave',
    ...(since === undefined ? [] : ['--since', String(since)]),
  ], {timeout: 15_000});
  // A native engine failure can settle the job with exit 1. CLI errors have no job.
  const settledFailure = exitCode === 1 && ['failed', 'stalled'].includes(value?.state) &&
    ['idle', 'completed', 'failed'].includes(value?.job?.state);
  return {idle: exitCode === 0 || settledFailure, exitCode, messages: value?.messages};
}

async function isIdle(options) {
  return (await waitForTurn(options)).idle;
}

async function botRoster({port, fetcher = fetch}) {
  const response = await fetcher('http://127.0.0.1:' + projectPort(port) + '/api/bots?messages=0', {
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('Could not list project agents');
  const {bots} = await response.json();
  if (!Array.isArray(bots)) throw Error('Could not list project agents');
  return bots.map(({id, name, color, avatarUrl, mascotBody, mascotFaceColor}) => ({
    id, name, color, avatarUrl, mascotBody, mascotFaceColor,
  }));
}

const avatarPath = /^\/api\/attachments\/[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/;
const avatarMime = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp']]);
const avatarLimit = 1024 * 1024;

async function botAvatar({port, url, fetcher = fetch}) {
  const match = typeof url === 'string' && url.match(avatarPath);
  if (!match) return undefined;
  const response = await fetcher('http://127.0.0.1:' + projectPort(port) + url, {
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body ||
      response.headers.get('content-type')?.split(';')[0] !== avatarMime.get(match[1]) ||
      Number(response.headers.get('content-length')) > avatarLimit) return undefined;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > avatarLimit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  if (!total) return undefined;
  return {bytes: Buffer.concat(chunks, total), filename: 'agent-avatar.' + match[1]};
}

async function listBots(options) {
  return new Set((await botRoster(options)).map(bot => bot.id));
}

module.exports = {projectPort, runAgent, isIdle, waitForTurn, listBots, botRoster, botAvatar};
