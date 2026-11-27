const fs = require('node:fs');
const path = require('node:path');
const {Client, Events, GatewayIntentBits} = require('discord.js');
const {loadConfig} = require('./lib/config.cjs');
const {projectPort, isIdle, waitForTurn, botRoster, runAgent} = require('./lib/omb.cjs');
const {route, statusText, outcome} = require('./lib/route.cjs');
const {splitMessage} = require('./lib/split.cjs');
const {openStore} = require('./lib/store.cjs');
const {perKey} = require('./lib/queue.cjs');
const {identityFor} = require('./lib/identity.cjs');
const {avatarCache} = require('./lib/avatar-cache.cjs');
const {replySender} = require('./lib/sender.cjs');
const {uploadAttachments, attachmentTurn, withInstructions} = require('./lib/attachments.cjs');
const {deferredReply} = require('./lib/deferred-reply.cjs');
const {gatewayFile, writeGateway} = require('./lib/gateway-state.cjs');

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    // Installed but not configured: exit 0 so process-compose (restart: on_failure) does not retry.
    console.log('Discord not configured: DISCORD_BOT_TOKEN is not set; bridge not started');
    return;
  }
  const port = projectPort(process.env.FYSO_OMB_PORT);

  const root = process.env.FYSO_ROOT || process.cwd();
  const healthFile = gatewayFile(root);
  // Keep a 4014 across supervisor retries until a successful connection replaces it.
  const health = state => {
    try { writeGateway(healthFile, state); }
    catch { console.error('Could not record Discord gateway health'); }
  };
  const configFile = path.join(root, 'project', 'discord.yaml');
  const threads = openStore(path.join(root, '.data', 'ext', 'discord', 'threads.json'));
  const enqueue = perKey();
  let config;
  const reload = () => {
    config = loadConfig(configFile, config);
    for (const error of config.errors) console.error(error);
  };

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
  const avatarDirectory = path.join(root, '.data', 'ext', 'discord', 'avatars');
  const currentAvatar = avatarCache(avatarDirectory, {port});
  const sendChunk = replySender(client, console.error, avatarDirectory);
  const agentIdentity = async bot => identityFor(bot, await currentAvatar(bot));
  const send = async (channel, text, options) => {
    const chunks = splitMessage(text, options?.identity ? 1910 : 2000);
    for (const [index, content] of chunks.entries()) {
      const progress = index === 0 ? options?.progress : undefined;
      await sendChunk(channel, content, {...options, progress});
    }
  };
  reload();
  fs.watchFile(configFile, {interval: 2000, persistent: false}, reload);

  async function completePending(threadId, entry, providedChannel) {
    const {pending} = entry;
    if (config.channels.get(entry.channelId) !== entry.botId) {
      threads.set(threadId, {...entry, pending: undefined, state: 'idle'});
      return true;
    }
    const result = await waitForTurn({taskId: entry.taskId, since: pending.since, port});
    if (!result.idle) return false;

    const reply = deferredReply(result.messages, pending.since);
    if (!reply && result.exitCode === 0) {
      console.error('OpenMausBot completed a deferred turn without a correlated reply');
      threads.set(threadId, {...entry, pending: undefined, state: 'idle'});
      return true;
    }
    const channel = providedChannel ?? await client.channels.fetch(threadId);
    if (!channel?.isThread() || channel.parentId !== entry.channelId ||
        config.channels.get(entry.channelId) !== entry.botId) return false;
    const bot = reply && (await botRoster({port})).find(bot => bot.id === entry.botId);
    const identity = reply ? await agentIdentity(bot) : undefined;
    const chunks = splitMessage(reply?.text ?? statusText('failed', config.language), identity ? 1910 : 2000);
    for (let index = pending.sent ?? 0; index < chunks.length; index++) {
      await sendChunk(channel, chunks[index], {identity, mode: config.senderModes.get(entry.channelId) ?? 'webhook',
        nonce: pending.sourceId + ':' + index.toString(36)});
      threads.set(threadId, {...entry, pending: {...pending, sent: index + 1}});
    }
    threads.set(threadId, {...entry, pending: undefined, state: 'idle'});
    return true;
  }

  let polling = false;
  async function deliverPending() {
    if (polling || !client.isReady()) return;
    polling = true;
    try {
      for (const [id, entry] of threads.all()) {
        if (!entry.pending) continue;
        await enqueue(id, async () => {
          const current = threads.get(id);
          if (current?.pending) await completePending(id, current);
        }).catch(() => console.error('Discord could not deliver a deferred turn'));
      }
    } finally {
      polling = false;
    }
  }

  async function handle(message, input) {
    let decision = route(input, config, threads);
    if (decision.action === 'ignore') return;
    const language = config.language;
    const entry = threads.get(input.threadId);
    if (decision.action === 'busy') {
      const idle = entry.pending
        ? await completePending(input.threadId, entry, message.channel)
        : await isIdle({taskId: entry.taskId, port});
      if (!idle) {
        const kind = decision.state === 'waiting' ? 'needsInput' : 'timeout';
        await send(message.channel, statusText(kind, language));
        return;
      }
      if (!entry.pending) threads.set(input.threadId, {...entry, state: 'idle'});
      decision = route(input, config, threads);
      if (decision.action !== 'continue') return;
    }

    const bot = (await botRoster({port})).find(bot => bot.id === decision.botId);
    if (!bot) {
      console.error('Discord channel references an unknown project agent');
      return;
    }

    const starting = decision.action === 'start';
    const channelId = starting ? input.channelId : entry.channelId;
    const taskId = starting ? 'new' : decision.taskId;
    const name = (message.content.trim() || message.attachments.first()?.name || '').trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/, '') || 'Fyso';
    const channel = starting ? await message.startThread({name}) : message.channel;
    const files = message.attachments.size
      ? await uploadAttachments([...message.attachments.values()], {
        port, data: process.env.FYSO_DATA || path.join(root, '.data'), messageId: message.id,
      })
      : {tags: [], rejected: 0};
    if (files.rejected) await send(channel, statusText('attachmentRejected', language));
    if (!files.tags.length && !message.content.trim()) return;
    if (!starting) threads.set(channel.id, {...entry, pending: undefined, state: 'working'});
    const typing = () => { void channel.sendTyping().catch(() => {}); };
    const mode = config.senderModes.get(channelId) ?? 'webhook';
    const identity = await agentIdentity(bot);
    // A webhook cannot show Discord's native typing indicator.
    const progress = mode === 'webhook'
      ? await sendChunk.begin(channel, identity, statusText('typing', language))
      : undefined;
    const interval = mode === 'webhook' ? undefined : setInterval(typing, 8000);
    if (interval) typing();
    let result;
    try {
      const displayName = message.member?.displayName ?? message.author.displayName;
      const caption = message.content.trim() || statusText('attachmentOnly', language);
      const turn = attachmentTurn(displayName, caption, files.tags);
      const text = starting ? withInstructions(turn, config.instructions.get(channelId)) : turn;
      result = await runAgent({botId: decision.botId, taskId, text, port});
    } catch {
      result = {exitCode: 1};
    } finally {
      clearInterval(interval);
    }

    const reply = outcome(result);
    const conversation = result.threadId || (taskId === 'new' ? null : taskId);
    if (conversation) {
      // With an ambiguous failure, verify native state before sending another turn.
      const state = reply.kind === 'failed' ? 'working' : reply.state;
      const pending = (state === 'waiting' || reply.kind === 'timeout') && result.since
        ? {since: result.since, sourceId: message.id}
        : undefined;
      threads.set(channel.id, {taskId: conversation, channelId, botId: decision.botId, state, pending});
    } else if (reply.kind !== 'failed') {
      console.error('OpenMausBot did not return a conversation ID');
    }
    if (reply.kind === 'failed') console.error('OpenMausBot Discord turn failed');
    await send(channel, reply.text ?? statusText(reply.kind, language), {
      identity: reply.text ? identity : undefined, mode, progress,
    });
  }

  client.once(Events.ClientReady, () => {
    health('connected');
    void deliverPending();
  });
  client.on(Events.ShardResume, () => health('connected'));
  const heartbeat = setInterval(() => {
    if (client.isReady()) {
      health('connected');
      void deliverPending();
    }
  }, 15_000);
  heartbeat.unref();

  client.on(Events.MessageCreate, message => {
    if (!message.inGuild() || message.author.bot || message.webhookId || (!message.content.trim() && !message.attachments.size)) return;
    const input = {
      authorIsBot: message.author.bot,
      isWebhook: Boolean(message.webhookId),
      channelId: message.channelId,
      threadId: message.channel.isThread() ? message.channelId : null,
      parentId: message.channel.parentId,
      mentionsMe: message.mentions.users.has(client.user.id),
    };
    // A thread created from a message shares that message's ID.
    void enqueue(input.threadId ?? message.id, () => handle(message, input))
      .catch(() => console.error('Discord bridge could not process a message'));
  });
  client.on(Events.Error, () => console.error('Discord client error'));
  client.on(Events.ShardError, () => console.error('Discord gateway error'));
  client.on(Events.ShardDisconnect, ({code}) => {
    if (code === 4014) {
      health('intent_disabled');
      console.error('Enable the Message Content intent in the Discord Developer Portal');
      process.exit(1);
    }
    health('connecting');
  });
  const stop = async () => {
    clearInterval(heartbeat);
    health('offline');
    fs.unwatchFile(configFile);
    await client.destroy();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await client.login(token).catch(error => {
    if (/disallowed intents/i.test(error.message)) {
      health('intent_disabled');
      throw Error('Enable the Message Content intent in the Discord Developer Portal');
    }
    throw Error('Discord gateway login failed');
  });
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
