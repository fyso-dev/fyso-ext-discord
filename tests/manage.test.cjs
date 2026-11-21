const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {manage} = require('../extensions/discord/manage.cjs');
const {channelPermissions, permissions} = require('../extensions/discord/lib/discord.cjs');
const {loadConfig} = require('../extensions/discord/lib/config.cjs');

const guild = '100000000000000001';
const id = '100000000000000002';
const hidden = '100000000000000003';
const botId = '100000000000000004';
const roles = [{id: guild, permissions: String(permissions)}];
const member = {roles: []};
const overwrite = {id: guild, type: 0, allow: '0', deny: '1024'};
const channels = [{id, guild_id: guild, type: 0, name: 'test'}, {id: hidden, type: 0, name: 'hidden', permission_overwrites: [overwrite]}];

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-panel-'));
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  const responses = new Map([
    ['/users/@me', {id: botId, username: 'Test Bot'}],
    ['/users/@me/guilds?limit=200', [{id: guild, name: 'Server'}]],
    ['/guilds/' + guild + '/channels', channels],
    ['/guilds/' + guild + '/members/' + botId, member],
    ['/guilds/' + guild + '/roles', roles],
    ['/channels/' + id, channels[0]],
  ]);
  return {
    file: path.join(folder, 'discord.yaml'),
    gateway: () => 'connected',
    api: async route => {
      assert.ok(responses.has(route), route);
      return responses.get(route);
    },
    roster: async () => [{id: 'support', name: 'Support'}, {id: 'operator', name: 'Operator'}],
  };
}

test('applies role and member overrides and administrator bypass', () => {
  const channel = {guild_id: guild, permission_overwrites: [overwrite,
    {id: 'role', type: 0, allow: '1024', deny: '0'},
    {id: botId, type: 1, allow: '0', deny: '2048'}]};
  assert.deepEqual(channelPermissions(channel, {roles: ['role']}, roles, botId), ['send']);
  assert.deepEqual(channelPermissions(channel, member, [{id: guild, permissions: '8'}], botId), []);
});

test('shows only visible unassigned channels and reports inaccessible assignments', async t => {
  const context = fixture(t);
  fs.writeFileSync(context.file, 'channels:\n- channel: "' + hidden + '"\n  bot: support\n');
  const result = await manage({op: 'status'}, context);
  assert.equal(result.connection, 'connected');
  assert.match(result.invite, /client_id=100000000000000004/);
  assert.equal(result.channels.find(item => item.id === hidden).missing[0], 'view');
  fs.unlinkSync(context.file);
  assert.deepEqual((await manage({op: 'status'}, context)).channels.map(item => item.id), [id]);
});

test('creates, changes and removes mappings and rejects stale edits', async t => {
  const context = fixture(t);
  assert.deepEqual(await manage({op: 'set', channel: id, bot: 'support', previous: ''}, context), {saved: true});
  assert.equal(loadConfig(context.file).channels.get(id), 'support');
  assert.deepEqual(await manage({op: 'set', channel: id, bot: 'operator', previous: ''}, context), {error: 'assignment_changed'});
  assert.deepEqual(await manage({op: 'set', channel: id, bot: 'operator', previous: 'support'}, context), {saved: true});
  assert.equal(loadConfig(context.file).channels.get(id), 'operator');
  assert.deepEqual(await manage({op: 'remove', channel: id, previous: 'operator'}, context), {saved: true});
  assert.equal(loadConfig(context.file).channels.size, 0);
});

test('saves the trigger mode and rejects a stale trigger edit', async t => {
  const context = fixture(t);
  const input = {op: 'set', channel: id, bot: 'support'};
  assert.deepEqual(await manage({...input, previous: '', mentionRequired: false}, context), {saved: true});
  assert.equal((await manage({op: 'status'}, context)).assignments[0].mentionRequired, false);
  assert.deepEqual(await manage({...input, previous: 'support', mentionRequired: true}, context),
    {error: 'assignment_changed'});
  assert.deepEqual(await manage({...input, previous: 'support', previousMentionRequired: false,
    mentionRequired: true}, context), {saved: true});
  assert.equal((await manage({op: 'status'}, context)).assignments[0].mentionRequired, true);
});

test('defaults to the agent as sender and keeps an explicit card', async t => {
  const context = fixture(t);
  assert.deepEqual(await manage({op: 'set', channel: id, bot: 'operator', previous: ''}, context), {saved: true});
  assert.equal((await manage({op: 'status'}, context)).assignments[0].senderMode, 'webhook');
  assert.equal(fs.readFileSync(context.file, 'utf8').includes('senderMode'), false);
  assert.deepEqual(await manage({op: 'set', channel: id, bot: 'operator', previous: 'operator', senderMode: 'card'}, context), {saved: true});
  assert.equal((await manage({op: 'status'}, context)).assignments[0].senderMode, 'card');
});

test('offers one invite with Manage Webhooks and a channel link', async t => {
  const context = fixture(t);
  const result = await manage({op: 'status'}, context);
  const invite = new URL(result.invite);
  const channel = result.channels.find(item => item.id === id);
  assert.equal(channel.discordUrl, 'https://discord.com/channels/' + guild + '/' + id);
  assert.equal(BigInt(invite.searchParams.get('permissions')) & 536870912n, 536870912n);
  assert.equal(result.webhookInvite, undefined);
  assert.equal(channel.webhookInvite, undefined);
});


test('saves, reports and clears channel instructions', async t => {
  const context = fixture(t);
  const input = {op: 'set', channel: id, bot: 'support'};
  assert.deepEqual(await manage({...input, previous: '', instructions: '  Formal tone  '}, context), {saved: true});
  assert.equal((await manage({op: 'status'}, context)).assignments[0].instructions, 'Formal tone');
  assert.deepEqual(await manage({...input, previous: 'support', instructions: ''}, context), {saved: true});
  assert.equal((await manage({op: 'status'}, context)).assignments[0].instructions, '');
  assert.equal(fs.readFileSync(context.file, 'utf8').includes('instructions'), false);
  assert.deepEqual(await manage({...input, previous: 'support', instructions: 'x'.repeat(2001)}, context), {error: 'invalid_input'});
});

test('enables outbound posting without an available OMB roster', async t => {
  const context = fixture(t);
  context.roster = async () => { throw Error('offline'); };
  assert.deepEqual(await manage({op: 'set', channel: id, bot: '', previous: '', previousPresent: false}, context), {saved: true});
  const result = await manage({op: 'status'}, context);
  assert.equal(result.assignments[0].bot, '');
  assert.deepEqual(result.bots, []);
  assert.equal(result.configError, false);
});
