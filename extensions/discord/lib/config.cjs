const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');

function yamlModule() {
  try {
    return require('yaml');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    // Project tasks can run before the Discord process installs its dependencies.
    const executable = execFileSync('which', ['yaml'], {encoding: 'utf8'}).trim();
    return createRequire(fs.realpathSync(executable))('yaml');
  }
}

const validChannel = id => typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
const validId = id => typeof id === 'string' && id.length > 0 &&
  !id.startsWith('-') && !/[\x00-\x20\x7f-\x9f]/.test(id);
const empty = () => ({language: 'es', channels: new Map(), errors: []});

function parseConfig(text) {
  const config = empty();
  const value = yamlModule().parse(text, {intAsBigInt: true}) ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Expected a mapping');
  }
  if (value.language === 'en') config.language = 'en';
  else if (value.language !== undefined && value.language !== 'es') {
    config.errors.push('language must be es or en');
  }
  if (value.channels !== undefined && !Array.isArray(value.channels)) {
    config.errors.push('channels must be a list');
  }
  const channels = Array.isArray(value.channels) ? value.channels : [];
  const seen = new Set();
  channels.forEach((entry, index) => {
    const channel = entry?.channel;
    if (!validChannel(channel)) {
      const label = typeof channel === 'bigint' ? ` (${channel})` : '';
      config.errors.push(`channels[${index + 1}].channel${label} must be a quoted 17–20 digit ID`);
    } else if (seen.has(channel)) {
      config.errors.push(`Duplicate channel ${channel}`);
    } else {
      seen.add(channel);
      if (validId(entry.bot)) config.channels.set(channel, entry.bot);
      else config.errors.push(`Channel ${channel} needs a valid bot ID`);
    }
  });
  return config;
}

function loadConfig(path, previous = empty()) {
  try {
    return parseConfig(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return empty();
    const problem = error.linePos?.[0];
    const location = problem ? ` at line ${problem.line}, column ${problem.col}` : '';
    return {...previous, errors: [`Could not read Discord configuration${location}`]};
  }
}

module.exports = {parseConfig, loadConfig, validChannel, validId, yamlModule};
