const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../extensions/discord/lib/store.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-store-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return path.join(dir, 'threads.json');
}

test('store survives reload', t => {
  const file = fixture(t);
  const id = '223456789012345678';
  const entry = {taskId: 'task-id', channelId: '123456789012345678', state: 'waiting'};
  openStore(file).set(id, entry);
  assert.deepEqual(openStore(file).get(id), entry);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('logs corruption without deleting the file', t => {
  const file = fixture(t);
  fs.writeFileSync(file, 'broken');
  const logs = [];
  assert.equal(openStore(file, message => logs.push(message)).all().size, 0);
  assert.equal(logs.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
});
