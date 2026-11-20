const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {botAvatar} = require('./omb.cjs');
const {revision: defaultRevision, renderMascot, validBody} = require('./mascot-renderer.cjs');

const fileType = /\.(png|jpg|gif|webp)$/;
const colors = new Set(['green', 'blue', 'red', 'orange', 'purple', 'cyan', 'pink', 'yellow', 'teal', 'coral', 'silver', 'chrome']);

function profile({mascotBody, color, mascotFaceColor}) {
  return {
    bodyId: validBody(mascotBody) ? mascotBody : undefined,
    color: colors.has(color) ? color : 'chrome',
    faceColor: ['white', 'black'].includes(mascotFaceColor) ? mascotFaceColor : undefined,
  };
}

function avatarCache(directory, {port, log = console.error, revision = defaultRevision,
  render = renderMascot, download = botAvatar} = {}) {
  const pending = new Map();
  const retryAt = new Map();

  async function cache(key, extension, load) {
    const file = path.join(directory, createHash('sha256').update(key).digest('hex') + '.' + extension);
    if (pending.has(file)) return pending.get(file);
    const operation = (async () => {
      try {
        const info = await fs.stat(file);
        if (info.isFile() && info.size > 0 && info.size <= 1024 * 1024) {
          return {bytes: await fs.readFile(file), filename: 'agent-avatar.' + extension};
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if ((retryAt.get(file) ?? 0) > Date.now()) return undefined;
      await fs.mkdir(directory, {recursive: true, mode: 0o700});
      const asset = await load();
      if (!asset) throw Error('Avatar unavailable');
      const temp = file + '.' + randomUUID();
      try {
        await fs.writeFile(temp, asset.bytes, {flag: 'wx', mode: 0o600});
        await fs.rename(temp, file);
      } finally { await fs.rm(temp, {force: true}); }
      retryAt.delete(file);
      return asset;
    })().catch(() => {
      if (retryAt.size >= 256) retryAt.clear();
      retryAt.set(file, Date.now() + 60_000);
      log('Could not refresh the OpenMausBot avatar');
      return undefined;
    }).finally(() => pending.delete(file));
    pending.set(file, operation);
    return operation;
  }

  return async bot => {
    if (!bot) return undefined;
    const extension = typeof bot.avatarUrl === 'string' && bot.avatarUrl.match(fileType)?.[1];
    if (extension) {
      // OMB assigns a new immutable attachment path to each upload.
      const avatar = await cache('upload:' + bot.avatarUrl, extension, () => download({port, url: bot.avatarUrl}));
      if (avatar) return avatar;
    }
    const mascot = profile(bot);
    const key = 'mascot:' + revision + ':' + JSON.stringify(mascot);
    return cache(key, 'png', () => render(mascot));
  };
}

module.exports = {avatarCache};
