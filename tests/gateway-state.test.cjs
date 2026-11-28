const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {readGateway, writeGateway} = require('../extensions/discord/lib/gateway-state.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-gateway-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return path.join(dir, 'gateway.json');
}

test('intent_disabled and invalid_token survive the staleness window', t => {
  const file = fixture(t);
  for (const state of ['intent_disabled', 'invalid_token']) {
    fs.writeFileSync(file, JSON.stringify({state, at: Date.now() - 10 * 60_000}));
    assert.equal(readGateway(file), state);
  }
});

test('connected goes stale and a fresh connected replaces invalid_token', t => {
  const file = fixture(t);
  fs.writeFileSync(file, JSON.stringify({state: 'connected', at: Date.now() - 60_000}));
  assert.equal(readGateway(file), 'offline');
  writeGateway(file, 'invalid_token');
  assert.equal(readGateway(file), 'invalid_token');
  writeGateway(file, 'connected');
  assert.equal(readGateway(file), 'connected');
  assert.equal(readGateway(path.join(path.dirname(file), 'missing.json')), 'offline');
});
