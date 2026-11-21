// One invite asks for everything the bridge uses, Manage Webhooks included: the agent then posts
// under its own name and avatar. A channel that denies it falls back to a card.
const manageWebhooks = 536870912n;
const permissions = 1024n | 2048n | 16384n | 32768n | 274877906944n | 34359738368n | 65536n | manageWebhooks;

class DiscordError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function discordApi(token, fetcher = fetch) {
  return async (path, body) => {
    if (!token) throw new DiscordError('token_missing', 'DISCORD_BOT_TOKEN is missing');
    let response;
    try {
      response = await fetcher('https://discord.com/api/v10' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: 'Bot ' + token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DiscordError('unreachable', 'Could not reach the Discord API');
    }
    const codes = {401: 'token_invalid', 403: 'missing_access', 404: 'missing_channel', 429: 'rate_limited'};
    if (!response.ok) {
      throw new DiscordError(codes[response.status] ?? 'unreachable',
        'Discord API check failed (HTTP ' + response.status + ')');
    }
    return response.json().catch(() => {
      throw new DiscordError('unreachable', 'Discord returned an invalid response');
    });
  };
}


function inviteUrl(id, {guildId} = {}) {
  const query = new URLSearchParams({
    client_id: id,
    scope: 'bot',
    permissions: String(permissions),
  });
  if (guildId) {
    query.set('guild_id', guildId);
    query.set('disable_guild_select', 'true');
  }
  return 'https://discord.com/oauth2/authorize?' + query;
}

const required = {
  view: 1024n,
  send: 2048n,
  send_threads: 274877906944n,
  create_threads: 34359738368n,
  history: 65536n,
};

// Discord applies @everyone, the union of role overwrites, then the member overwrite.
function channelPermissions(channel, member, roles, botId, requested = required) {
  const everyone = channel.guild_id;
  const membership = new Set([everyone, ...member.roles]);
  const apply = (bits, allow, deny) => (bits & ~deny) | allow;
  let bits = roles.filter(role => membership.has(role.id))
    .reduce((value, role) => value | BigInt(role.permissions), 0n);
  if (bits & 8n) return [];
  const overwrites = channel.permission_overwrites ?? [];
  const base = overwrites.find(item => item.id === everyone && item.type === 0);
  if (base) bits = apply(bits, BigInt(base.allow), BigInt(base.deny));
  let allow = 0n, deny = 0n;
  for (const item of overwrites) {
    if (item.type !== 0 || item.id === everyone || !membership.has(item.id)) continue;
    allow |= BigInt(item.allow);
    deny |= BigInt(item.deny);
  }
  bits = apply(bits, allow, deny);
  const user = overwrites.find(item => item.id === botId && item.type === 1);
  if (user) bits = apply(bits, BigInt(user.allow), BigInt(user.deny));
  return Object.entries(requested).filter(([, flag]) => !(bits & flag)).map(([key]) => key);
}

module.exports = {discordApi, DiscordError, inviteUrl, permissions, manageWebhooks, channelPermissions};
