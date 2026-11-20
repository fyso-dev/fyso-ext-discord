const {loadConfig, validChannel, validId, maxInstructions} = require('./lib/config.cjs');
const {discordApi, inviteUrl, manageWebhooks, channelPermissions} = require('./lib/discord.cjs');
const {botRoster} = require('./lib/omb.cjs');
const {gatewayFile, readGateway} = require('./lib/gateway-state.cjs');
const {editChannel, configPath} = require('./tools.cjs');

const {modes} = require('./lib/identity.cjs');
const identityPermissions = {embed_links: 16384n, attach_files: 32768n, manage_webhooks: manageWebhooks};
const channelTypes = new Set([0, 5]);

async function manage(input, {api, roster, file, gateway}) {
  const config = loadConfig(file);
  if (input.op !== 'status') {
    if (!['set', 'remove'].includes(input.op) || !validChannel(input.channel) ||
        (input.op === 'set' && !validId(input.bot))) return {error: 'invalid_input'};
    if ((input.mentionRequired !== undefined && typeof input.mentionRequired !== 'boolean') ||
        (input.previousMentionRequired !== undefined && typeof input.previousMentionRequired !== 'boolean')) {
      return {error: 'invalid_input'};
    }
    if ((input.senderMode !== undefined && !modes.has(input.senderMode)) ||
        (input.previousSenderMode !== undefined && !modes.has(input.previousSenderMode))) return {error: 'invalid_input'};
    if (input.instructions !== undefined && (typeof input.instructions !== 'string' ||
        input.instructions.trim().length > maxInstructions)) return {error: 'invalid_input'};
    if (config.errors.length) return {error: 'invalid_config'};
    const current = config.channels.get(input.channel) ?? '';
    const previousMentionRequired = input.previousMentionRequired ?? true;
    if (current !== input.previous || previousMentionRequired === config.withoutMention.has(input.channel)) {
      return {error: 'assignment_changed'};
    }
    if (input.op === 'set') {
      const [bots, channel] = await Promise.all([roster(), api('/channels/' + input.channel)]);
      if (!bots.some(bot => bot.id === input.bot)) return {error: 'unknown_agent'};
      if (!channelTypes.has(channel.type)) return {error: 'unsupported_channel'};
    }
    editChannel(file, input.channel, input.op === 'remove' ? null : input.bot, {
      expected: current, previousMentionRequired, mentionRequired: input.mentionRequired,
      senderMode: input.senderMode, previousSenderMode: input.previousSenderMode, instructions: input.instructions,
    });
    return {saved: true};
  }

  const assignments = [...config.channels].map(([channel, bot]) => ({
    channel, bot, mentionRequired: !config.withoutMention.has(channel), senderMode: config.senderModes.get(channel) ?? 'webhook',
    instructions: config.instructions.get(channel) ?? '',
  }));
  const account = await api('/users/@me');
  const [bots, guilds] = await Promise.all([roster(), api('/users/@me/guilds?limit=200')]);
  const results = await Promise.allSettled(guilds.map(async guild => {
    const [channels, member, roles] = await Promise.all([
      api('/guilds/' + guild.id + '/channels'),
      api('/guilds/' + guild.id + '/members/' + account.id),
      api('/guilds/' + guild.id + '/roles'),
    ]);
    return channels.filter(channel => channelTypes.has(channel.type) && validChannel(channel.id)).map(channel => ({
      id: channel.id, name: channel.name, guild: guild.name,
      discordUrl: validChannel(guild.id) ? 'https://discord.com/channels/' + guild.id + '/' + channel.id : undefined,
      missing: channelPermissions({...channel, guild_id: guild.id}, member, roles, account.id),
      identityMissing: channelPermissions({...channel, guild_id: guild.id}, member, roles, account.id, identityPermissions),
    }));
  }));
  const channels = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter(channel => !channel.missing.includes('view') || config.channels.has(channel.id));
  channels.sort((a, b) => a.guild.localeCompare(b.guild) || a.name.localeCompare(b.name));
  return {
    connection: gateway(), name: account.username, invite: inviteUrl(account.id),
    bots: bots.map(({id, name, avatarUrl}) => ({id, name, hasAvatar: Boolean(avatarUrl)})), channels, assignments, configError: Boolean(config.errors.length),
    partial: results.some(result => result.status === 'rejected'),
  };
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const encoded = process.argv[2];
    if (typeof encoded !== 'string' || encoded.length > 16384 || !/^[a-zA-Z0-9+/=]+$/.test(encoded)) {
      return {error: 'invalid_input'};
    }
    const input = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    const root = process.env.FYSO_ROOT || process.cwd();
    return manage(input, {
      api: discordApi(process.env.DISCORD_BOT_TOKEN),
      roster: () => botRoster({port: process.env.FYSO_OMB_PORT}),
      file: configPath(),
      gateway: () => readGateway(gatewayFile(root)),
    });
  }).catch(error => ({error: [
    'token_missing', 'token_invalid', 'unreachable', 'rate_limited', 'missing_access', 'missing_channel',
    'assignment_changed',
  ].includes(error.code) ? error.code : 'operation_failed'})).then(value => console.log(JSON.stringify(value)));
}

module.exports = {manage};
