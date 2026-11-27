const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {identityFor} = require('../extensions/discord/lib/identity.cjs');
const {botRoster, botAvatar} = require('../extensions/discord/lib/omb.cjs');
const {replySender} = require('../extensions/discord/lib/sender.cjs');
const {createRequire} = require('node:module');
const {PermissionFlagsBits} = createRequire(require.resolve('../extensions/discord/lib/sender.cjs'))('discord.js');

const bot = {id: 'operator', name: 'Run Operator', color: 'red', mascotBody: 'cursor', mascotFaceColor: undefined, avatarUrl: '/api/attachments/native.png'};
const avatar = {bytes: Buffer.from('fixture image'), filename: 'agent-avatar.png'};
const identity = identityFor(bot, avatar);

test('reads only native identity and fetches its image from the explicit project port', async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'error');
    return url.includes('/api/bots') ? Response.json({bots: [{...bot, soul: 'private'}]})
      : new Response(avatar.bytes, {headers: {'Content-Type': 'image/png'}});
  };
  const port = 18544;
  assert.deepEqual(await botRoster({port, fetcher}), [bot]);
  assert.deepEqual(await botAvatar({port, fetcher, url: bot.avatarUrl}), avatar);
  assert.equal(await botAvatar({port, fetcher, url: 'https://example.invalid/avatar.png'}), undefined);
  assert.deepEqual(urls, ['http://127.0.0.1:18544/api/bots?messages=0', 'http://127.0.0.1:18544/api/attachments/native.png']);
  assert.equal(identity.name, 'Run Operator');
  assert.equal(identity.color, 0xd94b52);
  assert.equal(identityFor({...bot, avatarUrl: null}).avatar, undefined);
});

function fixture(flags) {
  const calls = [];
  const me = {id: 'bot'};
  const guild = {members: {me}};
  const permissionsFor = () => ({has: flag => flags.includes(flag)});
  const hook = {send: async options => {calls.push(['webhook', options]);}};
  const parent = {id: 'parent', permissionsFor, fetchWebhooks: async () => [],
    createWebhook: async options => {calls.push(['create', options]); return hook;}};
  const channel = {id: 'thread', parent, parentId: parent.id, permissionsFor, guild,
    send: async options => {calls.push(['bot', options]);}};
  return {calls, channel, send: replySender({user: me})};
}

test('shows the native avatar as a card attachment and falls back to a text label', async () => {
  const card = fixture([PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles]);
  await card.send(card.channel, 'reply', {identity, nonce: 'turn:0'});
  assert.deepEqual(card.calls[0], ['bot', {nonce: 'turn:0', enforceNonce: true, allowedMentions: {parse: []},
    embeds: [{author: {name: bot.name}, color: identity.color, description: 'reply',
      thumbnail: {url: 'attachment://agent-avatar.png'}}],
    files: [{attachment: avatar.bytes, name: avatar.filename}]}]);
  const fallback = fixture([]);
  await fallback.send(fallback.channel, 'reply', {identity, mode: 'webhook'});
  assert.equal(fallback.calls[0][1].content, '**Run Operator**\nreply');
});

test('uses the native image as the webhook avatar for the opted-in channel', async () => {
  const hook = fixture([PermissionFlagsBits.ManageWebhooks]);
  await hook.send(hook.channel, 'reply', {identity, mode: 'webhook'});
  await hook.send(hook.channel, 'another', {identity, mode: 'webhook'});
  assert.deepEqual(hook.calls[0][1].avatar, avatar.bytes);
  assert.deepEqual(hook.calls[1], ['webhook', {
    threadId: 'thread', username: bot.name, allowedMentions: {parse: []}, content: 'reply',
  }]);
  assert.equal(hook.calls.filter(([name]) => name === 'create').length, 1);
});

test('the progress reply has the agent as sender and is replaced by the result', async () => {
  const f = fixture([PermissionFlagsBits.ManageWebhooks]);
  const edits = [];
  f.channel.parent.createWebhook = async () => ({
    send: async options => {
      assert.equal(options.username, bot.name);
      assert.equal(options.content, 'Typing…');
      return {id: 'progress-message'};
    },
    editMessage: async (id, options) => edits.push([id, options]),
  });
  const progress = await f.send.begin(f.channel, identity, 'Typing…');
  await f.send(f.channel, 'Final', {identity, mode: 'webhook', progress});
  assert.deepEqual(edits, [['progress-message', {
    content: 'Final', threadId: 'thread', allowedMentions: {parse: []},
  }]]);
  assert.equal(f.calls.length, 0);
});

test('does not reupload an unchanged webhook avatar after a bridge restart', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-avatar-receipt-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const f = fixture([PermissionFlagsBits.ManageWebhooks]);
  const client = {user: f.channel.guild.members.me};
  let edits = 0;
  const existing = {
    id: '123456789012345678', owner: client.user, token: 'fixture', avatar: null,
    send: async () => {},
    async edit({avatar}) { edits++; this.avatar = avatar ? 'discord-' + edits : null; return this; },
  };
  f.channel.parent.createWebhook = async ({name, avatar}) => {
    existing.name = name;
    existing.avatar = avatar ? 'first' : null;
    return existing;
  };
  await replySender(client, undefined, directory)(f.channel, 'One', {identity, mode: 'webhook'});
  f.channel.parent.fetchWebhooks = async () => [existing];
  await replySender(client, undefined, directory)(f.channel, 'Two', {identity, mode: 'webhook'});
  assert.equal(edits, 0);
  await replySender(client, undefined, directory)(f.channel, 'Unavailable', {
    identity: {...identity, avatar: undefined}, mode: 'webhook',
  });
  assert.equal(existing.avatar, 'first');
  assert.equal(edits, 0);
  const changed = {...identity, avatar: {...avatar, bytes: Buffer.from('new image')}};
  await replySender(client, undefined, directory)(f.channel, 'Three', {identity: changed, mode: 'webhook'});
  assert.equal(edits, 1);
});

const report = {attachment: Buffer.from('report'), name: 'report.md'};

test('passes outgoing files on the webhook, card and plain paths', async () => {
  const hook = fixture([PermissionFlagsBits.ManageWebhooks]);
  await hook.send(hook.channel, 'reply', {identity, mode: 'webhook', files: [report]});
  assert.deepEqual(hook.calls[1][1].files, [report]);
  const card = fixture([PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles]);
  await card.send(card.channel, 'reply', {identity, files: [report]});
  assert.deepEqual(card.calls[0][1].files, [{attachment: avatar.bytes, name: avatar.filename}, report]);
  const plain = fixture([PermissionFlagsBits.AttachFiles]);
  await plain.send(plain.channel, 'reply', {identity, files: [report]});
  assert.deepEqual(plain.calls[0][1].files, [report]);
  await plain.send(plain.channel, 'reply', {files: [report]});
  assert.deepEqual(plain.calls[1][1].files, [report]);
});

test('drops files without Attach Files permission and reports it', async () => {
  const f = fixture([]);
  let dropped = 0;
  await f.send(f.channel, 'reply', {files: [report], onDropped: () => dropped++});
  assert.equal(f.calls[0][1].files, undefined);
  assert.equal(dropped, 1);
});

test('retries without the outgoing files when Discord says the upload is too large', async () => {
  const f = fixture([PermissionFlagsBits.ManageWebhooks]);
  const hook = (await f.channel.parent.createWebhook({}));
  let attempts = 0;
  hook.send = async options => {
    f.calls.push(['webhook', options]);
    if (!attempts++) throw Object.assign(Error('too large'), {code: 40005});
  };
  let dropped = 0;
  await f.send(f.channel, 'reply', {identity, mode: 'webhook', files: [report], onDropped: () => dropped++});
  const sent = f.calls.filter(([name]) => name === 'webhook');
  assert.deepEqual(sent[0][1].files, [report]);
  assert.equal(sent[1][1].files, undefined);
  assert.equal(dropped, 1);
  const card = fixture([PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles]);
  let tries = 0;
  card.channel.send = async options => {
    card.calls.push(['bot', options]);
    if (!tries++) throw Object.assign(Error('too large'), {status: 413});
  };
  await card.send(card.channel, 'reply', {identity, files: [report]});
  assert.deepEqual(card.calls[1][1].files, [{attachment: avatar.bytes, name: avatar.filename}]);
});

test('reports dropped files once and does not resend them after a failed progress retry', async () => {
  const f = fixture([PermissionFlagsBits.AttachFiles]);
  let edits = 0;
  const progress = {id: 'p', hook: {editMessage: async () => {
    if (!edits++) throw Object.assign(Error('too large'), {code: 40005});
    throw Object.assign(Error('gone'), {code: 10008});
  }}};
  let dropped = 0;
  await f.send(f.channel, 'reply', {progress, files: [report], onDropped: () => dropped++});
  assert.equal(dropped, 1);
  assert.equal(f.calls[0][1].files, undefined);
});
