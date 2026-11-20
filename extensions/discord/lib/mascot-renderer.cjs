const {Resvg} = require('@resvg/resvg-js');
const {identityFor} = require('./identity.cjs');

const revision = 'vector-mascot-v2';
const bodies = new Map(Object.entries({
  cursor: 'M62 28Q46 17 45 42L51 204Q53 225 69 215L113 176L191 164Q211 163 204 145Z',
  blob: 'M67 48Q111 17 158 42Q205 62 197 110Q224 154 179 184Q153 218 105 198Q38 205 41 152Q17 108 42 78Z',
  circle: 'M128 28A100 100 0 1 1 128 228A100 100 0 0 1 128 28Z',
  squircle: 'M92 30H164Q226 30 226 92V164Q226 226 164 226H92Q30 226 30 164V92Q30 30 92 30Z',
  capsule: 'M128 29Q199 29 199 102V154Q199 227 128 227Q57 227 57 154V102Q57 29 128 29Z',
  drop: 'M128 25Q136 25 147 43L195 111Q223 152 200 192Q177 225 128 226Q79 225 56 192Q33 152 61 111L109 43Q120 25 128 25Z',
  shield: 'M128 28Q170 52 214 55V124Q214 184 128 228Q42 184 42 124V55Q86 52 128 28Z',
  hexagon: 'M116 30Q128 24 140 30L210 72Q222 80 222 94V164Q222 177 210 184L140 226Q128 232 116 226L46 184Q34 177 34 164V94Q34 80 46 72Z',
  diamond: 'M113 36Q128 21 143 36L220 113Q235 128 220 143L143 220Q128 235 113 220L36 143Q21 128 36 113Z',
  cat: 'M38 117L44 48Q45 33 58 42L92 72Q128 60 164 72L198 42Q211 33 212 48L218 117Q239 162 197 198Q168 222 128 222Q88 222 59 198Q17 162 38 117Z',
  bat: 'M128 75L151 48L159 79Q200 50 230 62Q207 93 224 125Q197 113 176 148Q162 165 128 184Q94 165 80 148Q59 113 32 125Q49 93 26 62Q56 50 97 79L105 48Z',
  ghost: 'M53 117Q53 50 128 39Q203 50 203 117V217L172 194L142 216L113 194L83 216L53 194Z',
  witch: 'M35 106L78 91L116 33Q128 15 143 38L174 91L218 105Q225 113 215 122L192 132Q206 155 190 181Q168 213 128 213Q88 213 66 181Q50 155 64 132L42 124Q28 118 35 106Z',
  pumpkin: 'M118 50L123 25Q132 18 141 28L138 50Q181 41 206 71Q235 106 222 161Q211 216 155 220Q128 231 101 220Q45 216 34 161Q21 106 50 71Q75 41 118 50Z',
  skull: 'M49 103Q49 39 128 39Q207 39 207 103V153Q207 178 178 182L172 217H84L78 182Q49 178 49 153Z',
  monster: 'M48 62Q48 46 66 46H190Q208 46 208 62V121H225V148H208V190Q208 212 186 212H70Q48 212 48 190V148H31V121H48Z',
  mummy: 'M58 105Q58 39 128 39Q198 39 198 105V166Q198 216 128 216Q58 216 58 166Z',
  vampire: 'M46 73Q50 45 88 41L128 69L168 41Q206 45 210 73L200 137Q199 177 178 194L210 221H46L78 194Q57 177 56 137Z',
  spider: 'M91 94L65 60L45 72L70 114L39 102L27 124L69 143L38 155L42 177L78 164L64 193L81 208L105 180Q128 194 151 180L175 208L192 193L178 164L214 177L218 155L187 143L229 124L217 102L186 114L211 72L191 60L165 94Q128 76 91 94Z',
  star: 'M114 37Q128 11 142 37L164 83L216 91Q242 95 223 114L186 152L194 204Q198 231 175 219L128 195L81 219Q58 231 62 204L70 152L33 114Q14 95 40 91L92 83Z',
}));

function shade(rgb, delta) {
  return '#' + [16, 8, 0].map(shift =>
    Math.max(0, Math.min(255, ((rgb >> shift) & 255) + delta)).toString(16).padStart(2, '0')).join('');
}

function renderMascot(profile) {
  const body = bodies.has(profile.bodyId) ? profile.bodyId : 'cursor';
  const rgb = identityFor({color: profile.color}).color;
  const face = profile.faceColor === 'black' || (profile.faceColor !== 'white' &&
    ['chrome', 'silver', 'yellow'].includes(profile.color)) ? '#161820' : '#fff';
  const x = body === 'cursor' ? 105 : 128;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs><linearGradient id="body" x2="1" y2="1">
      <stop stop-color="${shade(rgb, 35)}"/><stop offset="100%" stop-color="${shade(rgb, -38)}"/>
    </linearGradient></defs>
    <path d="${bodies.get(body)}" fill="url(#body)" stroke="${shade(rgb, -50)}" stroke-width="4" stroke-linejoin="round"/>
    <g transform="translate(${x} 130)" fill="${face}">
      <ellipse cx="-17" cy="-9" rx="7" ry="13"/><ellipse cx="17" cy="-9" rx="7" ry="13"/>
      <path d="M-10 13Q0 20 10 13" fill="none" stroke="${face}" stroke-width="5" stroke-linecap="round"/>
    </g>
  </svg>`;
  return {bytes: new Resvg(svg).render().asPng(), filename: 'agent-avatar.png'};
}

module.exports = {revision, renderMascot, validBody: value => bodies.has(value)};
