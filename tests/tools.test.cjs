const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {addChannel, permissions} = require('../extensions/discord/tools.cjs');
const {loadConfig} = require('../extensions/discord/lib/config.cjs');
const tools = path.resolve(__dirname, '../extensions/discord/tools.cjs');

test('computes invite permissions', () => assert.equal(permissions, 309774633984n));

test('adds and updates channels while keeping comments', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-tools-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'project', 'discord.yaml');
  const first = '123456789012345678';
  const second = '223456789012345678';
  addChannel(file, first, 'support');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /language/);
  fs.appendFileSync(file, '# keep this comment\n');
  addChannel(file, second, 'other');
  addChannel(file, first, 'updated');
  assert.match(fs.readFileSync(file, 'utf8'), /# keep this comment/);
  assert.deepEqual([...loadConfig(file).channels], [[first, 'updated'], [second, 'other']]);

  const invalid = spawnSync(process.execPath, [tools, 'add', 'invalid', 'support'],
    {env: {...process.env, FYSO_ROOT: dir}, encoding: 'utf8'});
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /17–20 digit/);
});

test('posts a standalone message only to a configured channel', async t => {
  const {sendMessage} = require('../extensions/discord/tools.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-send-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'discord.yaml');
  const channel = '123456789012345678';
  const message = '223456789012345678';
  addChannel(file, channel, 'support');
  const api = async (route, body) => {
    assert.equal(route, '/channels/' + channel + '/messages');
    assert.deepEqual(body, {content: '@everyone status', allowed_mentions: {parse: []}});
    return {id: message};
  };
  assert.equal(await sendMessage(file, channel, '@everyone status', api), message);
  await assert.rejects(sendMessage(file, message, 'hello', api), /configured/);
  await assert.rejects(sendMessage(file, channel, ' ', api), /characters/);
});
