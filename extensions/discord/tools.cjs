const fs = require('node:fs');
const path = require('node:path');
const {loadConfig, validChannel, validId, yamlModule} = require('./lib/config.cjs');
const {listBots} = require('./lib/omb.cjs');

const permissions = 1024n | 2048n | 274877906944n | 34359738368n | 65536n;
const configPath = () => path.join(process.env.FYSO_ROOT || process.cwd(), 'project', 'discord.yaml');

async function botAccount(token) {
  if (!token) throw Error('DISCORD_BOT_TOKEN is missing');
  let response;
  try {
    response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {Authorization: 'Bot ' + token},
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw Error('Could not reach the Discord API');
  }
  if (!response.ok) throw Error('Discord token check failed (HTTP ' + response.status + ')');
  const account = await response.json().catch(() => null);
  if (!account?.bot || !validChannel(account.id)) throw Error('Discord did not return a bot account');
  return account.id;
}

function addChannel(file, channel, bot) {
  if (!validChannel(channel)) throw Error('Channel must be a 17–20 digit Discord ID');
  if (!validId(bot)) throw Error('A valid OpenMausBot ID is required');
  let source = '{}\n';
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
  if (!doc.has('channels')) doc.set('channels', doc.createNode([]));
  const channels = doc.get('channels', true);
  if (!yaml.isSeq(channels)) throw Error('channels must be a list');
  const existing = channels.items.find(item => yaml.isMap(item) && item.get('channel') === channel);
  if (existing) existing.set('bot', bot);
  else channels.add(doc.createNode({channel, bot}));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  // Do not clobber another edit made while reading the document.
  if (stat && fs.readFileSync(file, 'utf8') !== source) throw Error('Discord configuration changed; retry');
  fs.writeFileSync(file, String(doc), stat ? {} : {flag: 'wx'});
}

async function main([command, ...args]) {
  const file = configPath();
  if (command === 'add' && args.length === 2) {
    addChannel(file, ...args);
    console.log('Commit project/discord.yaml');
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (command === 'invite' && !args.length) {
    const id = await botAccount(token);
    console.log('https://discord.com/oauth2/authorize?client_id=' + id + '&scope=bot&permissions=' + permissions);
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

module.exports = {addChannel, permissions};
