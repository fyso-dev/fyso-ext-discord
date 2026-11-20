// The OpenMausBot 0.1.141 avatar palette, in the same color names as /api/bots.
const colors = new Map(Object.entries({
  green: 0x009957, blue: 0x377fe6, red: 0xd94b52, orange: 0xe78531,
  purple: 0x8057c8, cyan: 0x0ea5c6, pink: 0xd84f8b, yellow: 0xd8a729,
  teal: 0x01a492, coral: 0xe5634e, silver: 0xa8adb4, chrome: 0xb3bac4,
}));
const modes = new Set(['card', 'webhook']);

function identityFor(bot, avatar) {
  return {
    id: bot?.id ?? 'fyso',
    name: (bot?.name || 'Fyso').slice(0, 80).toWellFormed(),
    color: colors.get(bot?.color) ?? colors.get('chrome'),
    avatar,
  };
}

module.exports = {modes, identityFor};
