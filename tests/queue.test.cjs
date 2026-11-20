const test = require('node:test');
const assert = require('node:assert/strict');
const {perKey} = require('../extensions/discord/lib/queue.cjs');

test('serializes per thread while other threads overlap', async () => {
  const enqueue = perKey();
  const events = [];
  const {promise, resolve} = Promise.withResolvers();
  const first = enqueue('thread', async () => {
    events.push('first started');
    await promise;
    events.push('first finished');
    throw Error('first failed');
  });
  const second = enqueue('thread', async () => { events.push('second started'); });
  await enqueue('other', async () => { events.push('other started'); });
  assert.deepEqual(events, ['first started', 'other started']);
  resolve();
  await assert.rejects(first, /first failed/);
  await second;
  assert.deepEqual(events, ['first started', 'other started', 'first finished', 'second started']);
});
