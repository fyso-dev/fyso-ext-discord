const fs = require('node:fs');
const path = require('node:path');
const {loadConfig, validChannel, validId, yamlModule} = require('./lib/config.cjs');
const {listBots} = require('./lib/omb.cjs');

const {discordApi, inviteUrl, permissions} = require('./lib/discord.cjs');
const {randomUUID} = require('node:crypto');
const configPath = () => path.join(process.env.FYSO_ROOT || process.cwd(), 'project', 'discord.yaml');

async function botAccount(token) {
  const account = await discordApi(token)('/users/@me');
  if (!account?.bot || !validChannel(account.id)) throw Error('Discord did not return a bot account');
  return account.id;
}

function editConfig(file, edit) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const lock = file + '.lock';
  const fd = fs.openSync(lock, 'wx', 0o600);
  try { return editLocked(file, edit); }
  finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function editLocked(file, edit) {
  let source = '';
  let stat;
  try {
    source = fs.readFileSync(file, 'utf8');
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const yaml = yamlModule();
  const doc = yaml.parseDocument(source);
  if (doc.errors.length || (doc.contents && !yaml.isMap(doc.contents))) {
    throw Error('Fix project/discord.yaml before adding a channel');
  }
  edit(doc, yaml);
  // Do not clobber another edit made while reading the document.
  if (stat && fs.readFileSync(file, 'utf8') !== source) throw Error('Discord configuration changed; retry');
  const temporary = file + '.' + randomUUID();
  try {
    fs.writeFileSync(temporary, String(doc), {flag: 'wx', mode: stat?.mode ?? 0o644});
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function editChannel(file, channel, bot, {expected, previousMentionRequired, mentionRequired, senderMode, previousSenderMode, instructions} = {}) {
  if (!validChannel(channel)) throw Error('Channel must be a 17–20 digit Discord ID');
  if (bot !== null && !validId(bot)) throw Error('A valid OpenMausBot ID is required');
  return editConfig(file, (doc, yaml) => {
    if (!doc.has('channels')) doc.set('channels', doc.createNode([]));
    const channels = doc.get('channels', true);
    if (!yaml.isSeq(channels)) throw Error('channels must be a list');
    const existing = channels.items.find(item => yaml.isMap(item) && item.get('channel') === channel);
    const changedBot = expected !== undefined && (existing?.get('bot') ?? '') !== expected;
    const currentMentionRequired = existing?.get('mentionRequired') !== false;
    const changedTrigger = previousMentionRequired !== undefined && previousMentionRequired !== currentMentionRequired;
    const changedSender = previousSenderMode !== undefined && (existing?.get('senderMode') ?? 'webhook') !== previousSenderMode;
    if (changedBot || changedTrigger || changedSender) {
      throw Object.assign(Error('Discord assignment changed; reload and retry'), {code: 'assignment_changed'});
    }
    if (bot === null) {
      if (!existing) return;
      channels.delete(channels.items.indexOf(existing));
    } else {
      const entry = existing ?? doc.createNode({channel, bot});
      entry.set('bot', bot);
      if (mentionRequired === false) entry.set('mentionRequired', false);
      else if (mentionRequired === true && entry.has('mentionRequired')) entry.set('mentionRequired', true);
      if (senderMode === 'card' || (senderMode === 'webhook' && entry.has('senderMode'))) entry.set('senderMode', senderMode);
      if (typeof instructions === 'string') {
        if (instructions.trim()) entry.set('instructions', instructions.trim());
        else entry.delete('instructions');
      }
      if (!existing) channels.add(entry);
    }
  });
}

async function main([command, ...args]) {
  const file = configPath();
  if (command === 'add' && args.length === 2) {
    editChannel(file, ...args);
    console.log('Commit project/discord.yaml');
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (command === 'invite' && !args.length) {
    const id = await botAccount(token);
    console.log(inviteUrl(id));
    return;
  }
  if (command !== 'check' || args.length) throw Error('Usage: tools.cjs check | invite | add <channel-id> <bot-id>');

  const {channels, errors} = loadConfig(file);
  await botAccount(token).catch(error => errors.push(error.message));
  if (channels.size) {
    try {
      const bots = await listBots({port: process.env.FYSO_OMB_PORT});
      for (const [channel, bot] of channels) {
        if (!bots.has(bot)) errors.push('Channel ' + channel + ' references an unknown project agent');
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  } else {
    console.log(channels.size ? 'Discord token and channels verified' : 'Discord token verified; no channel enabled yet');
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {addChannel: editChannel, editChannel, configPath, permissions};
