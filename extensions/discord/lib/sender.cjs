const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {PermissionFlagsBits} = require('discord.js');

const hookName = 'Fyso Agent Replies';
const rejected = new Set([10015, 50001, 50013, 50035]);

function replySender(client, log = console.error, avatarDirectory) {
  const receiptPath = hook => avatarDirectory && /^\d{17,20}$/.test(hook.id)
    ? path.join(avatarDirectory, 'webhook-' + hook.id + '.json') : undefined;

  async function receipt(hook) {
    const file = receiptPath(hook);
    if (file) try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    return {};
  }

  async function record(hook, signature) {
    const file = receiptPath(hook);
    if (!file) return;
    const temp = file + '.' + randomUUID();
    try {
      await fs.mkdir(avatarDirectory, {recursive: true, mode: 0o700});
      await fs.writeFile(temp, JSON.stringify({signature, avatar: hook.avatar ?? null}), {flag: 'wx', mode: 0o600});
      await fs.rename(temp, file);
    } catch { log('Could not save Discord avatar synchronization state'); }
    finally { await fs.rm(temp, {force: true}).catch(() => {}); }
  }

  const hooks = new Map();

  function webhook(parent, identity) {
    const name = hookName + ' ' + createHash('sha256').update(identity.id).digest('hex').slice(0, 16);
    const key = parent.id + ':' + identity.id;
    const signature = identity.avatar ? createHash('sha256').update(identity.avatar.bytes).digest('hex') : '';
    const current = hooks.get(key);
    if (current?.signature === signature) return current.init;
    const init = (async () => {
      const existing = await current?.init.catch(() => undefined) ?? (await parent.fetchWebhooks()).find(hook =>
        hook.name === name && hook.owner?.id === client.user.id && hook.token);
      const avatar = identity.avatar?.bytes;
      if (!existing) {
        const created = await parent.createWebhook({name, avatar, reason: 'Fyso Discord agent identity'});
        await record(created, signature);
        return created;
      }
      const previous = await receipt(existing);
      // A transient renderer failure must leave the last confirmed Discord image in place.
      if (avatar && (previous.signature !== signature || previous.avatar !== (existing.avatar ?? null))) {
        await existing.edit({avatar, reason: 'Sync OpenMausBot avatar'});
        await record(existing, signature);
      }
      return existing;
    })().catch(error => {
      if (hooks.get(key)?.init === init) hooks.delete(key);
      throw error;
    });
    hooks.set(key, {init, signature});
    return init;
  }

  async function send(channel, content, {identity, mode, nonce, progress} = {}) {
    const allowedMentions = {parse: []};
    if (progress) {
      try { return await progress.hook.editMessage(progress.id, {content, threadId: channel.id, allowedMentions}); }
      catch (error) {
        if (!rejected.has(error.code) && error.code !== 10008) throw error;
      }
    }
    const opts = {...(nonce ? {nonce, enforceNonce: true} : {}), allowedMentions};
    if (!identity) return channel.send({...opts, content});
    const member = channel.guild.members.me;
    if (mode === 'webhook' && member && channel.parent?.permissionsFor(member)?.has(PermissionFlagsBits.ManageWebhooks)) {
      let hook;
      try { hook = await webhook(channel.parent, identity); }
      catch { log('Discord identity webhook could not be initialized'); }
      if (hook) {
        try {
          return await hook.send({threadId: channel.id, username: identity.name,
            allowedMentions, content});
        } catch (error) {
          if (!rejected.has(error.code)) throw error;
          if (error.code === 10015) hooks.delete(channel.parentId + ':' + identity.id);
          log('Discord rejected the identity webhook message');
        }
      }
    }
    if (member && channel.permissionsFor(member)?.has(PermissionFlagsBits.EmbedLinks)) {
      try {
        const avatar = channel.permissionsFor(member)?.has(PermissionFlagsBits.AttachFiles)
          ? identity.avatar : undefined;
        return await channel.send({...opts, embeds: [{
          author: {name: identity.name}, color: identity.color, description: content,
          ...(avatar ? {thumbnail: {url: 'attachment://' + avatar.filename}} : {}),
        }], ...(avatar ? {files: [{attachment: avatar.bytes, name: avatar.filename}]} : {})});
      } catch (error) {
        if (!rejected.has(error.code)) throw error;
      }
    }
    // Thread names and agent names are trusted configuration and cannot trigger mentions.
    const label = '**' + identity.name.replace(/[\\*`_|~<>]/g, '') + '**\n';
    return channel.send({...opts, content: label.length + content.length <= 2000 ? label + content : content});
  };

  send.begin = async (channel, identity, content) => {
    const member = channel.guild.members.me;
    if (!member || !channel.parent?.permissionsFor(member)?.has(PermissionFlagsBits.ManageWebhooks)) return;
    try {
      const hook = await webhook(channel.parent, identity);
      const message = await hook.send({threadId: channel.id, username: identity.name,
        allowedMentions: {parse: []}, content});
      return {hook, id: message.id};
    } catch {
      log('Discord could not show the agent progress message');
    }
  };

  return send;
}

module.exports = {replySender};
