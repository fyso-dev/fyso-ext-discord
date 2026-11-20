const fs = require('node:fs');
const path = require('node:path');
const {Client, Events, GatewayIntentBits} = require('discord.js');
const {loadConfig} = require('./lib/config.cjs');
const {projectPort, isIdle, listBots, runAgent} = require('./lib/omb.cjs');
const {route, statusText, outcome} = require('./lib/route.cjs');
const {splitMessage} = require('./lib/split.cjs');
const {openStore} = require('./lib/store.cjs');
const {perKey} = require('./lib/queue.cjs');

async function main() {
  const port = projectPort(process.env.FYSO_OMB_PORT);
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw Error('DISCORD_BOT_TOKEN is missing');

  const root = process.env.FYSO_ROOT || process.cwd();
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
  const send = async (channel, text) => {
    for (const content of splitMessage(text)) {
      await channel.send({content, allowedMentions: {parse: []}});
    }
  };
  reload();
  fs.watchFile(configFile, {interval: 2000, persistent: false}, reload);

  async function handle(message, input) {
    let decision = route(input, config, threads);
    if (decision.action === 'ignore') return;
    const language = config.language;
    const entry = threads.get(input.threadId);
    if (decision.action === 'busy') {
      if (!await isIdle({taskId: entry.taskId, port})) {
        const kind = decision.state === 'waiting' ? 'needsInput' : 'timeout';
        await send(message.channel, statusText(kind, language));
        return;
      }
      threads.set(input.threadId, {...entry, state: 'idle'});
      decision = route(input, config, threads);
      if (decision.action !== 'continue') return;
    }

    const bots = await listBots({port});
    if (!bots.has(decision.botId)) {
      console.error('Discord channel references an unknown project agent');
      return;
    }

    const starting = decision.action === 'start';
    const channelId = starting ? input.channelId : entry.channelId;
    const taskId = starting ? 'new' : decision.taskId;
    const name = message.content.trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/, '') || 'Fyso';
    const channel = starting ? await message.startThread({name}) : message.channel;
    if (!starting) threads.set(channel.id, {...entry, state: 'working'});
    const typing = () => { void channel.sendTyping().catch(() => {}); };
    typing();
    const interval = setInterval(typing, 8000);
    let result;
    try {
      const displayName = message.member?.displayName ?? message.author.displayName;
      result = await runAgent({botId: decision.botId, taskId, text: displayName + ': ' + message.content, port});
    } finally {
      clearInterval(interval);
    }

    const reply = outcome(result);
    const conversation = result.threadId || (taskId === 'new' ? null : taskId);
    if (conversation) {
      // With an ambiguous failure, verify native state before sending another turn.
      const state = reply.kind === 'failed' ? 'working' : reply.state;
      threads.set(channel.id, {taskId: conversation, channelId, botId: decision.botId, state});
    } else if (reply.kind !== 'failed') {
      console.error('OpenMausBot did not return a conversation ID');
    }
    if (reply.kind === 'failed') console.error('OpenMausBot Discord turn failed');
    await send(channel, reply.text ?? statusText(reply.kind, language));
  }

  client.on(Events.MessageCreate, message => {
    if (!message.inGuild() || message.author.bot || message.webhookId || !message.content.trim()) return;
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
      console.error('Enable the Message Content intent in the Discord Developer Portal');
      process.exit(1);
    }
  });
  const stop = async () => {
    fs.unwatchFile(configFile);
    await client.destroy();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await client.login(token).catch(error => {
    if (/disallowed intents/i.test(error.message)) {
      throw Error('Enable the Message Content intent in the Discord Developer Portal');
    }
    throw Error('Discord gateway login failed');
  });
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
