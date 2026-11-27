const test = require('node:test');
const assert = require('node:assert/strict');
const {linkedFiles, fetchReplyFiles} = require('../extensions/discord/lib/reply-files.cjs');

test('extracts local link and image targets only', () => {
  const text = [
    '[a](reports/a.md) ![b](/abs/b.png "title") [c](<dir/with space.txt>)',
    '[web](https://x.test/a) [mail](mailto:a@b.c) [top](#top) [cdn](//x.test/a)',
    '[win](C:\\docs\\a.txt) [url](file:///tmp/a.txt) [dup](reports/a.md)',
    '[ref]: notes/ref.md',
  ].join('\n');
  assert.deepEqual(linkedFiles(text), ['reports/a.md', '/abs/b.png', 'dir/with space.txt',
    'C:\\docs\\a.txt', 'file:///tmp/a.txt', 'notes/ref.md']);
});

test('ignores links in code and caps the count', () => {
  assert.deepEqual(linkedFiles('`[a](a.md)`\n```\n[b](b.md)\n```\n~~~js\n[c](c.md)\n~~~\n[d](d.md)'), ['d.md']);
  const many = Array.from({length: 15}, (_, i) => `[f](f${i}.md)`).join(' ');
  assert.equal(linkedFiles(many).length, 10);
});

const base = {port: 18544, threadId: 'thread-1', messageId: 'msg-1'};

test('downloads through the project API and names files from content-disposition', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    const {path} = JSON.parse(options.body);
    const disposition = {
      'a.md': 'attachment; filename="report.md"',
      'b.md': "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.md",
    }[path];
    return new Response('data', {headers: disposition ? {'content-disposition': disposition} : {}});
  };
  const result = await fetchReplyFiles({...base, links: ['a.md', 'b.md', 'dir/c.txt'], fetcher});
  assert.deepEqual(result.files.map(file => file.name), ['report.md', 'résumé.md', 'c.txt']);
  assert.equal(result.rejected, 0);
  assert.equal(calls[0][0], 'http://127.0.0.1:18544/api/threads/thread-1/messages/msg-1/file');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0][1].body), {path: 'a.md'});
});

test('rejects folders, errors, empty and oversized files and keeps going', async () => {
  const fetcher = async (url, {body}) => {
    const {path} = JSON.parse(body);
    if (path === 'folder') return new Response('[]', {headers: {'x-openmausbot-folder': '1'}});
    if (path === 'missing') return new Response('no', {status: 404});
    if (path === 'empty') return new Response('');
    if (path === 'big') return new Response(Buffer.alloc(10 * 1024 * 1024 + 1));
    if (path === 'boom') throw Error('network');
    return new Response('ok');
  };
  const result = await fetchReplyFiles({...base, fetcher,
    links: ['folder', 'missing', 'empty', 'big', 'boom', 'good.txt']});
  assert.deepEqual(result.files.map(file => file.name), ['good.txt']);
  assert.equal(result.rejected, 5);
});

test('limits to 10 files and 25 MB in total', async () => {
  const ok = async () => new Response('x');
  const links = Array.from({length: 12}, (_, i) => `f${i}.txt`);
  const many = await fetchReplyFiles({...base, links, fetcher: ok});
  assert.equal(many.files.length, 10);
  assert.equal(many.rejected, 2);
  const big = async () => new Response(Buffer.alloc(9 * 1024 * 1024));
  const total = await fetchReplyFiles({...base, links: ['a', 'b', 'c', 'd'], fetcher: big});
  assert.equal(total.files.length, 2);
  assert.equal(total.rejected, 2);
});

test('invalid ids reject every link without fetching', async () => {
  const fetcher = async () => { throw Error('should not fetch'); };
  assert.deepEqual(await fetchReplyFiles({...base, threadId: '--x', links: ['a', 'b'], fetcher}), {files: [], rejected: 2});
});

test('a missing message id rejects every link', async () => {
  const fetcher = async () => { throw Error('should not fetch'); };
  assert.deepEqual(await fetchReplyFiles({...base, messageId: undefined, links: ['a']}), {files: [], rejected: 1});
});
