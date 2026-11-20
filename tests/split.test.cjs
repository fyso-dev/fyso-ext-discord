const test = require('node:test');
const assert = require('node:assert/strict');
const {splitMessage} = require('../extensions/discord/lib/split.cjs');

test('leaves short text alone and skips blank text', () => {
  assert.deepEqual(splitMessage('hello'), ['hello']);
  assert.deepEqual(splitMessage(' \n '), []);
});

test('prefers paragraph, line, then space boundaries', () => {
  for (const separator of ['\n\n', '\n', ' ']) {
    const first = 'aaaa' + separator;
    const text = first + 'bbbb cccccc';
    const chunks = splitMessage(text, 12);
    assert.equal(chunks[0], separator === ' ' ? first + 'bbbb ' : first);
    assert.equal(chunks.join(''), text);
  }
});

test('splits a long unbroken line', () => {
  const text = 'x' + '🙂'.repeat(2500);
  const chunks = splitMessage(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 2000 && chunk.isWellFormed()));
});

test('balances code fences and retains the language', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const text = fence + 'js\n' + '🙂'.repeat(2500) + '\n' + fence;
  const chunks = splitMessage(text);
  assert.ok(chunks.every(chunk => chunk.length <= 2000 && chunk.isWellFormed()));
  assert.ok(chunks.every(chunk => chunk.startsWith(fence + 'js\n') && chunk.endsWith('\n' + fence)));
  assert.equal(chunks.map(chunk => chunk.slice(6, -4)).join(''), '🙂'.repeat(2500));
});

test('skips whitespace-only chunks Discord would reject', () => {
  const chunks = splitMessage('aaa' + ' '.repeat(4000) + 'bbb');
  assert.ok(chunks.every(chunk => chunk.trim()));
  assert.equal(chunks.map(chunk => chunk.trim()).join(''), 'aaabbb');
});

test('closes a long unterminated fence without sending an empty opening block', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const chunks = splitMessage(fence + 'js\n' + 'a'.repeat(3000));
  assert.ok(chunks.every(chunk => chunk.startsWith(fence + 'js\n') && chunk.endsWith('\n' + fence)));
  assert.ok(chunks.every(chunk => chunk.length > 10 && chunk.length <= 2000));
  assert.equal(chunks.map(chunk => chunk.slice(6, -4)).join(''), 'a'.repeat(3000));
});
