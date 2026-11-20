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
  if (typeof value?.reply?.text === 'string') result.reply = {text: value.reply.text};
  return result;
}

async function isIdle({taskId, port, bin = 'openmausbot'}) {
  requireId(taskId);
  const {exitCode, value} = await invoke(bin, [
    'wait', '--thread', taskId, '--port', projectPort(port), '--json',
    '--timeout', '5s', '--on-input', 'exit', '--on-timeout', 'leave',
  ], {timeout: 15_000});
  // A native engine failure can settle the job with exit 1. CLI errors have no job.
  const settledFailure = exitCode === 1 && ['failed', 'stalled'].includes(value?.state) &&
    ['idle', 'completed', 'failed'].includes(value?.job?.state);
  return exitCode === 0 || settledFailure;
}

async function listBots({port, bin = 'openmausbot'}) {
  const {exitCode, value} = await invoke(bin, ['bots', '--json', '--port', projectPort(port)],
    {timeout: 15_000});
  if (exitCode || !Array.isArray(value?.bots)) throw Error('Could not list project agents');
  return new Set(value.bots.map(bot => bot.id));
}

module.exports = {projectPort, runAgent, isIdle, listBots};
