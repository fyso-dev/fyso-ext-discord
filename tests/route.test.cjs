const test = require('node:test');
const assert = require('node:assert/strict');
const {route, outcome, statusText} = require('../extensions/discord/lib/route.cjs');

test('routes only enabled mentions and owned threads', () => {
  const normal = {channelId: 'channel', mentionsMe: true};
  const thread = {threadId: 'thread', parentId: 'channel'};
  const config = {channels: new Map([['channel', 'support']])};
  const threads = new Map();
  const ignored = {action: 'ignore'};
  for (const msg of [
    {...normal, authorIsBot: true}, {...normal, isWebhook: true},
    {...normal, mentionsMe: false}, {...normal, channelId: 'disabled'}, thread,
  ]) assert.deepEqual(route(msg, config, threads), ignored);

  assert.deepEqual(route(normal, config, threads), {action: 'start', botId: 'support'});
  const entry = {taskId: 'task', channelId: 'channel', state: 'idle'};
  threads.set('thread', entry);
  config.channels.set('channel', 'updated');
  assert.deepEqual(route(thread, config, threads), {action: 'continue', botId: 'updated', taskId: 'task'});
  for (const state of ['waiting', 'working']) {
    entry.state = state;
    assert.deepEqual(route(thread, config, threads), {action: 'busy', state});
  }
  entry.state = 'idle';
  entry.botId = 'support';
  assert.deepEqual(route(thread, config, threads), {action: 'continue', botId: 'updated', taskId: 'new'});
  config.channels.clear();
  assert.deepEqual(route(thread, config, threads), ignored);
});

test('maps exit codes to status in both languages', () => {
  assert.deepEqual(outcome({exitCode: 0, reply: {text: 'hello'}}), {kind: 'reply', state: 'idle', text: 'hello'});
  for (const [result, kind, state] of [
    [{exitCode: 0}, 'failed', 'idle'], [{exitCode: 1}, 'failed', 'idle'], [null, 'failed', 'idle'],
    [{exitCode: 3}, 'needsInput', 'waiting'], [{exitCode: 4}, 'timeout', 'working'],
  ]) assert.deepEqual(outcome(result), {kind, state, text: null});
  assert.equal(statusText('needsInput', 'es'), 'El agente está esperando una respuesta en el panel.');
  assert.equal(statusText('timeout', 'es'), 'Sigue trabajando; lo dejo corriendo.');
  assert.equal(statusText('failed', 'es'), 'Algo falló; revisá el panel.');
  assert.equal(statusText('needsInput', 'en'), 'The agent is waiting for an answer in the panel.');
  assert.equal(statusText('timeout', 'en'), "Still working; I'll leave it running.");
  assert.equal(statusText('failed', 'en'), 'Something failed; check the panel.');
});
