const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {runAgent, isIdle} = require('../extensions/discord/lib/omb.cjs');

const request = {
  bin: path.join(__dirname, 'fixtures', 'fake-openmausbot'),
  botId: 'support', taskId: 'new', text: 'name: Hello', port: '18542',
};

test('passes literal arguments and message on stdin using the project port', async t => {
  process.env.DISCORD_BOT_TOKEN = 'fixture-token';
  process.env.OPENMAUSBOT_URL = 'fixture-url';
  t.after(() => {
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.OPENMAUSBOT_URL;
  });
  const result = await runAgent(request);
  assert.equal(result.exitCode, 0);
  assert.equal(result.threadId, 'task-id');
  assert.deepEqual(JSON.parse(result.reply.text), {
    argv: ['run', '--bot', 'support', '-', '--port', '18542', '--json', '--task', 'new',
      '--timeout', '30m', '--on-input', 'exit', '--on-timeout', 'leave'],
    text: request.text,
  });
  assert.equal(await isIdle({...request, taskId: 'task-id'}), true);
});

test('preserves waiting and timeout exit codes', async t => {
  t.after(() => { delete process.env.FAKE_OMB_EXIT; });
  for (const code of [3, 4]) {
    process.env.FAKE_OMB_EXIT = String(code);
    assert.equal((await runAgent(request)).exitCode, code);
    assert.equal(await isIdle({...request, taskId: 'task-id'}), false);
  }
});

test('invalid output is failure', async t => {
  process.env.FAKE_OMB_INVALID = '1';
  t.after(() => { delete process.env.FAKE_OMB_INVALID; });
  assert.deepEqual(await runAgent(request), {exitCode: 1});
});

test('rejects bad ports and unsafe identifiers before spawn', async () => {
  for (const port of ['', 0, 65536, '1e4', '123.0', '-1']) {
    await assert.rejects(runAgent({...request, port}), /FYSO_OMB_PORT/);
  }
  await assert.rejects(runAgent({...request, botId: '--json'}), /ID/);
  await assert.rejects(runAgent({...request, taskId: 'bad\ntask'}), /ID/);
});

test('only clears a failed wait when the native job has settled', async t => {
  process.env.FAKE_OMB_EXIT = '1';
  process.env.FAKE_OMB_STATE = 'failed';
  t.after(() => {
    delete process.env.FAKE_OMB_EXIT;
    delete process.env.FAKE_OMB_STATE;
    delete process.env.FAKE_OMB_JOB;
  });
  assert.equal(await isIdle({...request, taskId: 'task-id'}), false);
  process.env.FAKE_OMB_JOB = 'completed';
  assert.equal(await isIdle({...request, taskId: 'task-id'}), true);
});

test('returns the final reply id and its linked files', async t => {
  t.after(() => { delete process.env.FAKE_OMB_FILES; });
  assert.deepEqual((await runAgent(request)).reply.files, []);
  assert.equal((await runAgent(request)).reply.id, 'm3');
  process.env.FAKE_OMB_FILES = JSON.stringify(['a.md', 5, 'x'.repeat(1025), ...Array(12).fill('b.md')]);
  const {reply} = await runAgent(request);
  assert.equal(reply.files.length, 10);
  assert.deepEqual(reply.files.slice(0, 2), ['a.md', 'b.md']);
});
