const test = require('node:test');
const assert = require('node:assert/strict');
const {deferredReply} = require('../extensions/discord/lib/deferred-reply.cjs');

test('returns only the final reply for the deferred turn', () => {
  const reply = {role: 'bot', kind: 'text', at: 24, text: 'reply after approval'};
  const messages = [
    {role: 'bot', kind: 'text', at: 9, text: 'old reply'},
    {role: 'user', kind: 'text', at: 20, text: 'request'},
    {role: 'bot', kind: 'options', at: 21},
    reply,
    {role: 'bot', kind: 'digest', at: 25},
  ];
  assert.equal(deferredReply(messages, 19), reply);
  assert.equal(deferredReply(messages, 21), undefined);
  assert.equal(deferredReply([...messages, {role: 'user', kind: 'text', at: 26}], 19), undefined);
});
