const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseConfig, loadConfig} = require('../extensions/discord/lib/config.cjs');

const id = '123456789012345678';
const config = 'channels:\n  - channel: "' + id + '"\n    bot: support\n';

test('reads a channel and defaults to Spanish', () => {
  const value = parseConfig(config);
  assert.equal(value.language, 'es');
  assert.equal(value.channels.get(id), 'support');
  assert.deepEqual(value.errors, []);
  assert.equal(parseConfig('language: en').language, 'en');
});

test('reports language, unquoted snowflakes and duplicate entries', () => {
  const value = parseConfig('language: fr\n' + config +
    '  - channel: ' + id + '\n    bot: other\n' +
    '  - channel: "' + id + '"\n    bot: duplicate\n');
  assert.equal(value.language, 'es');
  assert.equal(value.channels.get(id), 'support');
  assert.equal(value.errors.length, 3);
  assert.match(value.errors[1], new RegExp(id));
});

test('invalid yaml keeps previous', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-config-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'config.yaml');
  assert.deepEqual(loadConfig(file).errors, []);
  fs.writeFileSync(file, '[[');
  const previous = parseConfig(config);
  const next = loadConfig(file, previous);
  assert.deepEqual(next.channels, previous.channels);
  assert.equal(next.errors.length, 1);
});

test('only an explicit false flag enables starting without a mention', () => {
  assert.equal(parseConfig(config).withoutMention.has(id), false);
  assert.equal(parseConfig(config + '    mentionRequired: false\n').withoutMention.has(id), true);
  const invalid = parseConfig(config + '    mentionRequired: "false"\n');
  assert.equal(invalid.withoutMention.has(id), false);
  assert.equal(invalid.errors.length, 1);
});

test('reads optional channel instructions and rejects invalid ones', () => {
  assert.equal(parseConfig(config).instructions.has(id), false);
  assert.equal(parseConfig(config + '    instructions: "Formal tone"\n').instructions.get(id), 'Formal tone');
  assert.equal(parseConfig(config + '    instructions: 3\n').errors.length, 1);
  assert.equal(parseConfig(config + '    instructions: "' + 'x'.repeat(2001) + '"\n').errors.length, 1);
});
