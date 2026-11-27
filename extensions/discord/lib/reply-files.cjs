const path = require('node:path');
const {projectPort} = require('./omb.cjs');
const {validId} = require('./config.cjs');
const {readBytes} = require('./attachments.cjs');

const mb = 1024 * 1024;
const maxFiles = 10;
const maxFile = 10 * mb;
const maxTotal = 25 * mb;

// Same filter OpenMausBot applies to reply links: local paths only.
function local(target) {
  if (!target || target.startsWith('#') || target.startsWith('//')) return false;
  return /^[a-z]:[\\/]/i.test(target) || /^file:/i.test(target) || !/^[a-z][a-z\d+.-]*:/i.test(target);
}

function linkedFiles(text) {
  const prose = String(text).replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, '')
    .replace(/(`+)[^`]*?\1/g, '');
  const targets = [];
  for (const match of prose.matchAll(/\]\(\s*(<[^>\n]*>|[^\s)]*)[^)]*\)/g)) targets.push(match[1]);
  for (const match of prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/gm)) targets.push(match[1]);
  const found = targets.map(target => target.replace(/^<(.*)>$/, '$1').trim()).filter(local);
  return [...new Set(found)].slice(0, maxFiles);
}

function fileName(response, link) {
  const header = response.headers.get('content-disposition') ?? '';
  let name;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) try { name = decodeURIComponent(star[1].trim()); } catch {}
  name ??= /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)?.[1].replace(/\\(.)/g, '$1') ??
    /filename\s*=\s*([^;"]+)/i.exec(header)?.[1].trim();
  name ??= path.posix.basename(link.replace(/\\/g, '/'));
  return name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180) || 'file';
}

async function fetchReplyFiles({port, threadId, messageId, links, fetcher = fetch}) {
  if (!validId(threadId) || !validId(messageId)) return {files: [], rejected: links.length};
  const url = 'http://127.0.0.1:' + projectPort(port) + '/api/threads/' + encodeURIComponent(threadId) +
    '/messages/' + encodeURIComponent(messageId) + '/file';
  const files = [];
  let rejected = Math.max(0, links.length - maxFiles);
  let remaining = maxTotal;
  for (const link of links.slice(0, maxFiles)) {
    try {
      const response = await fetcher(url, {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({path: link}),
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (response.headers.get('x-openmausbot-folder') === '1') {
        await response.body?.cancel();
        throw Error('Folder');
      }
      const attachment = await readBytes(response, Math.min(maxFile, remaining));
      remaining -= attachment.length;
      files.push({attachment, name: fileName(response, link)});
    } catch { rejected++; }
  }
  return {files, rejected};
}

module.exports = {linkedFiles, fetchReplyFiles};
