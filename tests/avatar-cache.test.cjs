const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {avatarCache} = require('../extensions/discord/lib/avatar-cache.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-avatar-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  return directory;
}

test('deduplicates concurrent renders and invalidates on native profile or bundle changes', async t => {
  const directory = await fixture(t);
  const renders = [];
  const build = revision => ({
    revision,
    render: async profile => {
      renders.push([revision, profile]);
      return {bytes: Buffer.from(JSON.stringify(profile)), filename: 'agent-avatar.png'};
    },
  });
  const bot = {name: 'MausBot', color: 'chrome'};
  const active = avatarCache(directory, build('omb1'));
  const first = await Promise.all([active(bot), active(bot)]);
  assert.deepEqual(first[0], first[1]);
  assert.equal(renders.length, 1);
  assert.deepEqual(await avatarCache(directory, build('omb1'))(bot), first[0]);
  assert.equal(renders.length, 1);

  const changed = await active({...bot, color: 'red', mascotBody: 'circle'});
  assert.notDeepEqual(changed, first[0]);
  assert.equal(renders.length, 2);
  await avatarCache(directory, build('omb2'))(bot);
  assert.equal(renders.length, 3);
});

test('caches uploaded avatars by native attachment path and refreshes on replacement', async t => {
  const directory = await fixture(t);
  const downloads = [];
  const dependencies = {
    port: '18544',
    render: () => { throw Error('Uploaded avatars do not need rendering'); },
    download: async ({port, url}) => {
      assert.equal(port, '18544');
      downloads.push(url);
      return {bytes: Buffer.from(url), filename: 'agent-avatar.png'};
    },
  };
  const old = {avatarUrl: '/api/attachments/first.png'};
  const replacement = {avatarUrl: '/api/attachments/new.png'};
  const prior = await avatarCache(directory, dependencies)(old);
  assert.deepEqual(await avatarCache(directory, dependencies)(old), prior);
  assert.notDeepEqual(await avatarCache(directory, dependencies)(replacement), prior);
  assert.deepEqual(downloads, [old.avatarUrl, replacement.avatarUrl]);
});

test('renders shape and color changes to PNG without a browser', async t => {
  const target = await fixture(t);
  const get = avatarCache(target);
  const cursor = await get({mascotBody: 'cursor', color: 'red'});
  const star = await get({mascotBody: 'star', color: 'red'});
  const blue = await get({mascotBody: 'star', color: 'blue'});
  const cat = await get({mascotBody: 'cat', color: 'red'});
  for (const avatar of [cursor, star, blue, cat]) {
    assert.equal(avatar.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.notDeepEqual(cursor.bytes, star.bytes);
  assert.notDeepEqual(cursor.bytes, cat.bytes);
  assert.notDeepEqual(star.bytes, blue.bytes);
});
