const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {addChannel, permissions} = require('../extensions/discord/tools.cjs');
const {loadConfig} = require('../extensions/discord/lib/config.cjs');
const tools = path.resolve(__dirname, '../extensions/discord/tools.cjs');

test('computes invite permissions', () => assert.equal(permissions, 309237713920n));

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
