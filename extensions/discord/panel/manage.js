import {
  createElement as h, mountExtensionPage, useDaguAction, useEffect, useState, useStore, useTranslation,
} from '/assets/extension-sdk.js';

const messages = Object.fromEntries(await Promise.all(['es', 'en'].map(async language =>
  [language, await (await fetch(`./locales/${language}.json`)).json()])));
const workflow = 'ext-discord-manage';
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const portal = 'https://discord.com/developers/applications';
const tokenErrors = new Set(['token_missing', 'token_invalid']);

// Connect Discord, then enable channels and optional agent replies.
// Identity and permissions are automatic and only surface when something needs a fix.
function DiscordPage() {
  const {t} = useTranslation();
  const {backend} = useStore();
  const action = useDaguAction(backend, workflow, 'result');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(null); // {channel, bot, mentionRequired, instructions, editing}
  const [removing, setRemoving] = useState('');
  const i = (key, options) => t('discord.' + key, options);

  async function reload() {
    const result = await action.start({REQUEST_B64: encode({op: 'status'})});
    if (!result || result.error) { setError(result?.error || 'operation_failed'); setData(null); }
    else setData(result);
  }

  async function connect(event) {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true); setError(''); setToken('');
    try {
      const response = await fetch('/api/extensions/discord/secrets', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({values: {DISCORD_BOT_TOKEN: token.trim()}}),
      });
      if (!response.ok) throw Error();
      await reload();
    } catch { setError('operation_failed'); } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError(''); setNotice('');
    try { await reload(); } catch { setError('operation_failed'); } finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function save(op, channel, values = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      const current = data.assignments.find(item => item.channel === channel);
      const result = await action.start({REQUEST_B64: encode({
        op, channel, bot: values.bot ?? '', mentionRequired: values.mentionRequired, instructions: values.instructions,
        previousPresent: Boolean(current), previous: current?.bot ?? '', previousMentionRequired: current?.mentionRequired ?? true,
      })});
      if (!result?.saved) { setError(result?.error || 'operation_failed'); return; }
      setNotice(op === 'remove' ? 'removed' : 'saved');
      setForm(null); setRemoving('');
      await reload();
    } catch { setError('operation_failed'); } finally { setBusy(false); }
  }

  const btn = (label, onClick, kind = 'soft', extra = {}) => h('button', {
    type: 'button', className: 'btn btn-sm btn-' + kind, disabled: busy, onClick, ...extra,
  }, i(label));
  const link = (href, label, kind = 'soft') => h('a', {
    href, target: '_blank', rel: 'noopener noreferrer', className: 'btn btn-sm btn-' + kind,
  }, i(label));
  const pill = (text, ok) => h('span', {className: 'pill pill-' + (ok ? 'ok' : 'warn')}, text);

  const channels = data?.channels ?? [];
  const assigned = new Set(data?.assignments?.map(item => item.channel));
  const detailOf = new Map(channels.map(item => [item.id, item]));
  const agentName = new Map(data?.bots?.map(item => [item.id, item.name]));
  const channelLabel = item => '#' + item.name + ' · ' + item.guild;
  const locked = busy || data?.configError;

  // Step 1: the Discord bot itself.
  function botStep() {
    const connection = tokenErrors.has(error) ? 'token_missing' : data?.connection;
    const ready = connection === 'connected';
    let body = null;
    if (connection === 'token_missing') {
      body = [h('p', {key: 'p'}, i(error === 'token_invalid' ? 'bot.tokenInvalid' : 'bot.tokenMissing')),
        h('div', {key: 'a', className: 'discord-row'},
          link(portal, 'bot.openPortal')),
        h('form', {key: 'token', onSubmit: connect, className: 'discord-row'},
          h('label', null, i('bot.token'), h('input', {type: 'password', autoComplete: 'new-password',
            value: token, maxLength: 4096, disabled: busy, onChange: event => setToken(event.target.value)})),
          h('button', {type: 'submit', className: 'btn btn-sm btn-pri', disabled: busy || !token.trim()}, i('bot.openSetup')))];
    } else if (connection === 'intent_disabled') {
      body = [h('p', {key: 'p'}, i('bot.intent')),
        h('div', {key: 'a', className: 'discord-row'}, link(portal, 'bot.openPortal', 'pri'))];
    } else if (data) {
      body = [
        h('p', {key: 'p'}, ready ? i('bot.connected', {name: data.name}) : i('bot.connecting')),
        data.invite && h('div', {key: 'a', className: 'discord-row'},
          link(data.invite, channels.length ? 'bot.inviteMore' : 'bot.invite', channels.length ? 'soft' : 'pri')),
        !channels.length && h('p', {key: 'h', className: 'hint'}, i('bot.inviteHelp')),
      ];
    }
    return h('section', {className: 'card discord-stack', 'aria-labelledby': 'discord-bot'},
      h('div', {className: 'discord-row discord-between'},
        h('h2', {id: 'discord-bot'}, i('bot.title')),
        connection && pill(i('states.' + connection, {defaultValue: connection}), ready)),
      body);
  }

  // One plain sentence about what is wrong with an assigned channel, or null.
  function problem(item) {
    const detail = detailOf.get(item.channel);
    if (!detail || detail.missing.includes('view')) return i('problems.noAccess');
    if (item.bot && !agentName.has(item.bot)) return i('problems.unknownAgent');
    const missing = detail.missing.filter(key => item.bot || key === 'view' || key === 'send');
    if (missing.length) return i('problems.permissions', {
      permissions: missing.map(key => i('permissions.' + key)).join(', '),
    });
    return null;
  }

  function editor() {
    const options = form.editing
      ? channels.filter(item => item.id === form.channel)
      : channels.filter(item => !assigned.has(item.id));
    const set = patch => setForm({...form, ...patch});
    const choice = (value, label) => h('label', {className: 'discord-row'},
      h('input', {type: 'radio', name: 'discord-trigger', checked: form.mentionRequired === value, disabled: locked,
        onChange: () => set({mentionRequired: value})}), i(label));
    return h('form', {className: 'discord-stack discord-editor', onSubmit: event => {
      event.preventDefault(); void save('set', form.channel, form);
    }},
    h('div', {className: 'discord-fields'},
      h('label', null, i('form.channel'),
        h('select', {value: form.channel, required: true, disabled: locked || form.editing,
          onChange: event => set({channel: event.target.value})},
        !form.editing && h('option', {value: ''}, i('form.chooseChannel')),
        options.map(item => h('option', {value: item.id, key: item.id}, channelLabel(item))))),
      h('label', null, i('form.agent'),
        h('select', {value: form.bot, disabled: locked, onChange: event => set({bot: event.target.value})},
          h('option', {value: ''}, i('form.chooseAgent')),
          data.bots.map(item => h('option', {value: item.id, key: item.id}, item.name))))),
    form.bot && h('fieldset', {className: 'discord-stack discord-choice'},
      h('legend', null, i('form.when')),
      choice(true, 'form.onMention'),
      choice(false, 'form.onEvery')),
    form.bot && h('label', {className: 'discord-stack discord-instructions'}, i('form.instructions'),
      h('textarea', {value: form.instructions, rows: 3, maxLength: 2000, disabled: locked,
        placeholder: i('form.instructionsExample'), onChange: event => set({instructions: event.target.value})}),
      h('span', {className: 'hint'}, i('form.instructionsHelp'))),
    !form.editing && !options.length && h('p', {className: 'hint'}, i('form.noFreeChannels')),
    h('div', {className: 'discord-row'},
      h('button', {type: 'submit', className: 'btn btn-sm btn-pri',
        disabled: locked || !form.channel || (form.bot && !agentName.has(form.bot))}, i('form.save')),
      btn('form.cancel', () => setForm(null))));
  }

  // Step 2: which agent answers in which channel.
  function channelStep() {
    const usable = Array.isArray(data?.assignments);
    return h('section', {className: 'card discord-stack', 'aria-labelledby': 'discord-channels'},
      h('h2', {id: 'discord-channels'}, i('channels.title')),
      h('p', {className: 'hint'}, i('channels.help')),
      !usable && !busy && h('p', {className: 'hint'}, i('channels.needsBot')),
      usable && data.configError && h('p', {role: 'alert', className: 'banner banner-down'}, i('errors.invalid_config')),
      usable && !data.assignments.length && !form && h('p', null, i('channels.empty')),
      usable && data.assignments.length > 0 && h('ul', {className: 'discord-list'}, data.assignments.map(item => {
        if (form?.editing && form.channel === item.channel) return h('li', {key: item.channel}, editor());
        const detail = detailOf.get(item.channel);
        const issue = problem(item);
        return h('li', {key: item.channel, className: 'discord-stack'},
          h('div', {className: 'discord-row discord-between'},
            h('strong', null, detail ? channelLabel(detail) : item.channel),
            pill(issue ? i('channels.attention') : i('channels.ok'), !issue)),
          h('p', null, item.bot ? i('channels.summary',  {
            agent: agentName.get(item.bot) ?? item.bot,
            when: i(item.mentionRequired ? 'channels.onMention' : 'channels.onEvery'),
          }) : i('channels.outbound')),
          item.bot && item.instructions && h('p', {className: 'hint discord-quote'}, item.instructions),
          issue && h('p', {className: 'hint'}, issue),
          removing === item.channel
            ? h('div', {className: 'discord-row'}, h('span', null, i('channels.confirmRemove')),
              btn('channels.remove', () => void save('remove', item.channel), 'pri'),
              btn('form.cancel', () => setRemoving('')))
            : h('div', {className: 'discord-row'},
              btn('channels.edit', () => setForm({channel: item.channel, bot: item.bot,
                mentionRequired: item.mentionRequired, instructions: item.instructions ?? '', editing: true}), 'soft', {disabled: locked || Boolean(form)}),
              btn('channels.remove', () => setRemoving(item.channel), 'soft', {disabled: locked || Boolean(form)}),
              issue && detail?.discordUrl && link(detail.discordUrl, 'channels.openInDiscord')));
      })),
      usable && form && !form.editing && editor(),
      usable && !form && (channels.length
        ? h('div', null, btn('channels.add', () => setForm({channel: '', bot: '', mentionRequired: true, instructions: '', editing: false}),
          data.assignments.length ? 'soft' : 'pri', {disabled: locked}))
        : h('p', {className: 'hint'}, i('channels.noVisible'))));
  }

  return h('main', {className: 'discord-page', 'aria-busy': busy},
    h('header', {className: 'discord-row discord-between'},
      h('h1', null, i('title')),
      btn('refresh', refresh)),
    busy && h('p', {role: 'status', className: 'hint'}, i('loading')),
    error && !tokenErrors.has(error) && h('p', {role: 'alert', className: 'banner banner-down'},
      i('errors.' + error, {defaultValue: i('errors.operation_failed')})),
    notice && h('p', {role: 'status', className: 'banner'}, i(notice)),
    botStep(),
    channelStep());
}

mountExtensionPage(DiscordPage, messages);
