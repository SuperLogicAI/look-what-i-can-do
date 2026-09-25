#!/usr/bin/env node
// look-what-i-can-do: README in, animated hero out. See PROPOSAL.md.
// Writes an animated SVG (the primary output) or, with --gif, a GIF export of the same SVG.
// Replay (default) animates the command and example output the README already shows, and runs nothing from the repo.
// --live runs the command in a pseudo-terminal and keeps its real output and colors.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.2.0';

// ---------- README ----------

// Markdown to plain text. Single underscores stay: snake_case names are more common in titles than _emphasis_.
const plain = s => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|\*|`/g, '').replace(/^>\s*/gm, '').replace(/\s+/g, ' ').trim();
const RUN = /^\s*(?:\$\s*)?((?:npx|npm|pnpm|yarn|bunx|pip|pipx|uvx|uv|brew|cargo|go|docker|deno|node|python3?)\b.*)$/;

// "$ command" and the lines after it, up to the next prompt.
const prompt = lines => {
    const i = lines.findIndex(l => l.startsWith('$ '));
    if (i < 0) return null;
    const next = lines.findIndex((l, j) => j > i && l.startsWith('$ '));
    return { command: lines[i].slice(2), output: lines.slice(i + 1, next < 0 ? undefined : next) };
};

/** Title, tagline, hero command and example output, as the README states them. A block fenced ```console hero wins. */
export function readReadme(md, fallbackTitle = '') {
    const blocks = [...md.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].map(m => {
        const [lang = '', ...flags] = m[1].trim().toLowerCase().split(/\s+/); // GitHub ignores words after the language: an invisible marker
        return { lang, hero: flags.includes('hero'), lines: m[2].replace(/\n$/, '').split('\n') };
    });
    const prose = md.replace(/^```[\s\S]*?^```/gm, '');
    const at = prose.search(/^#\s/m);
    const title = at >= 0 ? plain(prose.slice(at).match(/^#\s+(.+)$/m)[1]) : fallbackTitle;
    const para = plain((at >= 0 ? prose.slice(at).split('\n').slice(1).join('\n') : prose).split(/\n\s*\n/)
        .map(p => p.trim()).find(p => p && !/^(<|#|\||!\[|\[!\[)/.test(p)) ?? '');
    const tagline = para.length > 100 ? para.match(/^.{20,100}?[.!?](?=\s|$)/)?.[0] ?? para : para; // one line: first sentence(s)
    // The marked block, else the first console block with output. A marked block without a prompt is the output alone.
    const marked = blocks.find(b => b.hero);
    const found = marked ? prompt(marked.lines) ?? { output: marked.lines }
        : blocks.filter(b => b.lang === 'console').map(b => prompt(b.lines)).find(p => p?.output.length);
    const command = found?.command ?? blocks.filter(b => ['sh', 'bash', 'shell', 'zsh', ''].includes(b.lang))
        .flatMap(b => b.lines).map(l => l.match(RUN)?.[1]).find(Boolean);
    const output = found?.output ?? blocks.find(b => ['', 'text', 'txt', 'output'].includes(b.lang) && !RUN.test(b.lines[0]))?.lines ?? [];
    // <!-- look-what-i-can-do highlight="…" --> sets options without showing on the page. Outside code blocks only:
    // a README that documents the comment in an example must not configure itself with it.
    const options = {};
    for (const [, k, v] of (prose.match(/<!--\s*look-what-i-can-do\b([\s\S]*?)-->/)?.[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)) if (k === 'highlight') options.highlight = v;
    return { title, tagline, command: (command ?? '').replace(/\s+#.*$/, '').trim(), output, marked: !!marked, options };
}

// ---------- terminal output ----------
// A line is a list of segments { text, fg, bg, bold, dim, italic, underline }. fg/bg: 0-255 palette index or '#rrggbb'.

const ANSI16 = ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
    '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff']; // GitHub dark terminal palette

export function hex(c) {
    if (typeof c === 'string') return c;
    if (c < 16) return ANSI16[c];
    const h = v => v.toString(16).padStart(2, '0');
    if (c >= 232) return '#' + h(8 + (c - 232) * 10).repeat(3);
    const level = x => (x ? 55 + x * 40 : 0), n = c - 16;
    return '#' + [Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map(x => h(level(x))).join('');
}

function sgr(s, params) {
    const p = params ? params.split(';').map(Number) : [0];
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === 0) { for (const k in s) delete s[k]; }
        else if (c === 1) s.bold = true; else if (c === 2) s.dim = true; else if (c === 3) s.italic = true; else if (c === 4) s.underline = true;
        else if (c === 22) { delete s.bold; delete s.dim; } else if (c === 23) delete s.italic; else if (c === 24) delete s.underline;
        else if (c >= 30 && c <= 37) s.fg = c - 30; else if (c >= 90 && c <= 97) s.fg = c - 82; else if (c === 39) delete s.fg;
        else if (c >= 40 && c <= 47) s.bg = c - 40; else if (c >= 100 && c <= 107) s.bg = c - 92; else if (c === 49) delete s.bg;
        else if (c === 38 || c === 48) {
            const key = c === 38 ? 'fg' : 'bg';
            if (p[i + 1] === 5) { s[key] = p[i + 2]; i += 2; }
            else if (p[i + 1] === 2) { s[key] = '#' + p.slice(i + 2, i + 5).map(v => v.toString(16).padStart(2, '0')).join(''); i += 4; }
        }
    }
}

/** Raw terminal output, escapes and all, to styled lines. */
export function parseAnsi(raw) {
    let t = raw.replace(/\r\n/g, '\n')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC: hyperlinks, window titles
        .replace(/\x1b[()][\w@]|\x1b[=>78]/g, '');         // charset and keypad switches
    for (let prev; prev !== t;) { prev = t; t = t.replace(/[^\n\x08]\x08/g, ''); } // backspace erases (BSD script echoes "^D\b\b")
    t = t.replace(/^.*\r(?=.)/gm, ''); // carriage return: what follows overwrote the line (spinners, progress bars)
    const state = {};
    return t.split('\n').map(line => {
        const segs = [];
        const push = text => { text = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''); if (text) segs.push({ text, ...state }); };
        let last = 0;
        for (const m of line.matchAll(/\x1b\[([0-9;?<=>]*)([ -\/]*[@-~])/g)) {
            push(line.slice(last, m.index)); last = m.index + m[0].length;
            if (m[2] === 'm') sgr(state, m[1]);
            // Back to column 1, or clear the line: spinners redraw this way (npm's ⠙ is ESC[1G ESC[0K).
            // ponytail: only these two cursor moves; progress bars that move up lines need a screen buffer
            else if ((m[2] === 'G' && Number(m[1] || 1) <= 1) || (m[2] === 'K' && m[1] === '2')) segs.length = 0;
        }
        push(line.slice(last));
        return segs;
    });
}

const blank = line => !line.some(s => s.text.trim());
export const trim = lines => {
    let a = 0, b = lines.length;
    while (a < b && blank(lines[a])) a++;
    while (b > a && blank(lines[b - 1])) b--;
    return lines.slice(a, b);
};

/** Too tall for the frame: keep whole blocks from the top plus the last block (footer, link, call to action), and mark the cut. */
export function fit(lines, max) {
    if (lines.length <= max) return lines;
    const start = lines.findLastIndex(blank); // the blank line before the last block
    const tail = start > 0 && lines.length - start < max / 2 ? lines.slice(start) : [];
    let head = lines.slice(0, max - tail.length - 1);
    const cut = head.findLastIndex(blank);
    if (cut > head.length / 2) head = head.slice(0, cut);
    return [...head, [{ text: '⋮', dim: true }], ...tail];
}

// ---------- hero ----------

const W = 1280, MIN_H = 640, MAX_H = 960, FPS = 15;
const FRAME = 270; // px around the terminal lines: title, tagline, window bar, padding
const columns = line => line.reduce((n, s) => { for (const ch of s.text) n = ch === '\t' ? (Math.floor(n / 8) + 1) * 8 : n + 1; return n; }, 0);

/** Font size, visible lines and canvas height, so the widest line fits and nothing is cut without a mark. */
export function layout(lines, command) {
    const widest = Math.max(command.length + 2, ...lines.map(columns));
    // ponytail: assumes a 0.6em advance, which fits common monospace fonts; embed a subset font if viewers' fonts drift (PROPOSAL §4)
    const font = Math.max(11, Math.min(16, Math.floor((2 * 1090) / (0.6 * widest)) / 2));
    const lineH = font * 1.5;
    const shown = fit(lines, Math.floor((MAX_H - FRAME) / lineH) - 1);
    return { font, lineH, shown, H: Math.min(MAX_H, Math.max(MIN_H, Math.ceil(FRAME + (shown.length + 1) * lineH))) };
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ACCENTS = ['#7ee787', '#79c0ff', '#d2a8ff', '#ffa657', '#ff7b72', '#f2cc60', '#56d4dd', '#ff9bce'];
export const accentFor = title => ACCENTS[[...title].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % ACCENTS.length];
// System fonts: an SVG shown through <img> and GitHub's image proxy can't load web fonts from URLs.
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;

// SVG text has no tab stops, so tabs become spaces up to the next multiple of 8.
const expandTabs = line => {
    let col = 0;
    return line.map(s => {
        let text = '';
        for (const ch of s.text) { const n = ch === '\t' ? 8 - (col % 8) : 1; text += ch === '\t' ? ' '.repeat(n) : ch; col += n; }
        return { ...s, text };
    });
};

// Wider than the frame even at the smallest font: cut the line and mark the cut with …
const clip = (line, max) => {
    let n = 0;
    const out = [];
    for (const s of line) {
        const chars = [...s.text];
        if (n + chars.length <= max) { out.push(s); n += chars.length; continue; }
        out.push({ ...s, text: chars.slice(0, Math.max(0, max - n - 1)).join('') + '…' });
        break;
    }
    return out;
};

// ponytail: background colors are dropped (SVG text has none); draw rects on the column grid when a real README needs them
export function tspan(s) {
    const a = [s.fg !== undefined && `fill="${hex(s.fg)}"`, s.bold && 'font-weight="700"', s.dim && 'fill-opacity=".6"',
        s.italic && 'font-style="italic"', s.underline && 'text-decoration="underline"'].filter(Boolean).join(' ');
    return a ? `<tspan ${a}>${esc(s.text)}</tspan>` : esc(s.text);
}

/** The animated SVG and one loop's length. The accent colors the prompt and the optional highlight, never the output. */
export function heroSvg({ title, tagline, command, lines, highlight, accent = accentFor(title) }) {
    const { font, lineH, shown, H } = layout(lines, command);
    const typeAt = 1.2, perChar = Math.min(0.055, 1.2 / Math.max(command.length, 1));
    const typed = typeAt + command.length * perChar, enter = typed + 0.5, perLine = Math.min(0.1, 1.6 / Math.max(shown.length, 1));
    const hl = highlight ? shown.findIndex(l => l.map(s => s.text).join('').includes(highlight)) : -1;
    const hlAt = enter + shown.length * perLine + 0.35, end = Math.max(hlAt + 3.5, 7), seconds = end + 0.6;
    const at = t => `${(Math.min(t, seconds) / seconds * 100).toFixed(2)}%`;
    // Every element gets its own keyframes on one shared loop: animation-delay would drift elements out of phase after the first repeat.
    const rules = [];
    const anim = (frames, cls = '') => { rules.push(`@keyframes k${rules.length}{${frames}}`); return `class="a${cls && ` ${cls}`}" style="animation-name:k${rules.length - 1}"`; };
    const rise = (t, d, dy, cls) => anim(`0%,${at(t)}{opacity:0;transform:translateY(${dy}px)}${at(t + d)},100%{opacity:1;transform:none}`, cls);
    const top = tagline ? 167 : 124, x0 = 95, maxCols = Math.floor(1090 / (0.6 * font));
    const y = i => top + 49 + lineH / 2 + font * 0.35 + i * lineH; // baseline of terminal row i; row 0 is the command
    // Build every animated element before the stylesheet, which lists their keyframes.
    const stage = anim(`0%,${at(end)}{opacity:1}100%{opacity:0}`);
    const head = `<text x="72" y="88" ${rise(0, 0.6, 14, 't')}>${esc(title)}</text>`
        + (tagline ? `\n<text x="72" y="136" ${rise(0.35, 0.6, 14, 's')}>${esc(tagline)}</text>` : '');
    const win = rise(0.7, 0.5, 14);
    const chars = [...command].map((c, i) => c === ' ' ? ' '
        : `<tspan ${anim(`0%,${at(typeAt + i * perChar)}{opacity:0}${at(typeAt + i * perChar + 0.01)},100%{opacity:1}`)}>${esc(c)}</tspan>`).join('');
    const cursor = `<tspan ${anim(`0%,${at(typed)}{opacity:0}${at(typed + 0.01)},${at(enter)}{opacity:1}${at(enter + 0.01)},100%{opacity:0}`, 'c')}>█</tspan>`;
    const rows = shown.map((l, i) => (i === hl
        ? `<rect x="${x0 - 8}" y="${(y(i + 1) - lineH / 2 - font * 0.35).toFixed(1)}" width="1106" height="${lineH}" rx="4" fill="${accent}" fill-opacity=".22" ${anim(`0%,${at(hlAt)}{transform:scaleX(0)}${at(hlAt + 0.45)},100%{transform:scaleX(1)}`, 'g')}/>`
        : '') + `<text x="${x0}" y="${y(i + 1).toFixed(1)}" ${rise(enter + i * perLine, 0.25, 4, 'o')}>${clip(expandTabs(l), maxCols).map(tspan).join('')}</text>`).join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xml:space="preserve" role="img" aria-label="${esc([title, tagline].filter(Boolean).join(': '))}">
<style>
text{font:${font}px ${MONO};fill:#e6edf3;white-space:pre}
.t{font:800 56px ${SANS};letter-spacing:-1px}.s{font:400 23px ${SANS};fill:#8b98a5}
.a{animation:${seconds.toFixed(2)}s ease-out infinite both}.g{transform-box:fill-box;transform-origin:left center}
@media (prefers-reduced-motion:reduce){.a{animation:none}.c{display:none}}
${rules.join('\n')}
</style>
<rect width="${W}" height="${H}" fill="#0b0f14"/>
<g ${stage}>
${head}
<g ${win}>
<rect x="72.5" y="${top + 0.5}" width="1135" height="${H - top - 30}" rx="14" fill="#11161d" stroke="#232b35"/>
<path d="M73 ${top + 35}h1134" stroke="#232b35"/>
<circle cx="92" cy="${top + 18}" r="6" fill="#ff5f57"/><circle cx="112" cy="${top + 18}" r="6" fill="#febc2e"/><circle cx="132" cy="${top + 18}" r="6" fill="#28c840"/>
<text x="${x0}" y="${y(0).toFixed(1)}"><tspan fill="${accent}" font-weight="700">❯</tspan> ${chars}${cursor}</text>
${rows}
</g>
</g>
</svg>
`;
    return { svg, seconds, W, H, shown, highlighted: hl >= 0 };
}

/** GIF export: seeks the SVG's animations frame by frame in headless Chromium, then encodes with ffmpeg's palette filters. */
export async function renderGif({ svg, seconds, W, H }, out) {
    // ponytail: Chromium + ffmpeg for the export only; Phase 3 swaps in resvg-wasm and a JS GIF encoder (PROPOSAL §6)
    let chromium;
    try { ({ chromium } = await import('playwright-core')); } catch { throw new Error('playwright-core is missing: run npm install'); }
    const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))
        .catch(() => { throw new Error('no Chromium found: install Google Chrome, or run npx playwright-core install chromium-headless-shell'); });
    const dir = mkdtempSync(join(tmpdir(), 'lwicd-'));
    try {
        const page = await browser.newPage({ viewport: { width: W, height: H } });
        await page.setContent(`<body style="margin:0">${svg}</body>`);
        await page.evaluate(() => document.fonts.ready);
        const frames = Math.round(seconds * FPS);
        for (let i = 0; i < frames; i++) {
            await page.evaluate(t => document.getAnimations().forEach(a => { a.pause(); a.currentTime = t; }), (i * 1000) / FPS);
            await page.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.png`) });
        }
        try {
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
                '-vf', 'split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
                '-loop', '0', out]);
        } catch (e) { throw e.code === 'ENOENT' ? new Error('ffmpeg not found: brew install ffmpeg (or your package manager)') : e; }
        return frames;
    } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
}

/** Runs the command in a pseudo-terminal, so output that only a TTY gets (colors, footers) survives. */
export function runLive(command, cwd) {
    // ponytail: BSD/util-linux `script` gives a PTY with no native deps; Windows needs node-pty or ConPTY
    const inner = `stty cols 110 rows 50 2>/dev/null; ${command}`;
    const args = process.platform === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', inner] : ['-qec', inner, '/dev/null'];
    const { NO_COLOR, ...env } = process.env;
    const r = spawnSync('script', args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...env, FORCE_COLOR: '1', COLORTERM: 'truecolor', TERM: 'xterm-256color', npm_config_yes: 'true' } });
    if (r.error) throw r.error.code === 'ENOENT' ? new Error('--live needs the `script` command (macOS or Linux)') : r.error;
    return { raw: r.stdout, status: r.status };
}

// ---------- CLI ----------

const usage = `look-what-i-can-do ${VERSION}: your README, as an animated hero.

Usage: look-what-i-can-do [README.md] [-o file.svg] [--gif] [--live] [--command <cmd>] [--highlight <text>]

  -o, --out <file>      where to write it (default look-what-i-can-do.svg, or .gif with --gif)
  --gif                 export a GIF instead, for places that don't take SVG (needs Chromium and ffmpeg)
  --live                run the command in a terminal and show its real output and colors
                        (default: replay the example output the README shows; runs nothing)
  --command <cmd>       the command to show, and with --live to run (default: the README's)
  --highlight <text>    sweep a highlight over the first output line containing this text
  -h, --help            show this help
  -v, --version         show the version`;

async function main() {
    const fail = msg => { console.error(`look-what-i-can-do: ${msg}`); process.exit(2); };
    let values, positionals;
    try {
        ({ values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', short: 'o' }, gif: { type: 'boolean' },
            live: { type: 'boolean' }, command: { type: 'string' }, highlight: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } } }));
    } catch (e) { fail(`${e.message}\n\n${usage}`); }
    if (values.help) return console.log(usage);
    if (values.version) return console.log(VERSION);
    if (positionals.length > 1) fail(`one README at a time, got ${positionals.length}\n\n${usage}`);

    const gif = values.gif || /\.gif$/i.test(values.out ?? '');
    const readme = resolve(positionals[0] ?? 'README.md'), out = resolve(values.out ?? `look-what-i-can-do.${gif ? 'gif' : 'svg'}`);
    if (gif ? !/\.gif$/i.test(out) : !/\.svg$/i.test(out)) fail(`output must be .svg, or .gif with --gif; got ${basename(out)}`);
    let md;
    try { md = readFileSync(readme, 'utf8'); } catch { fail(`no README at ${readme}`); }
    const r = readReadme(md, basename(dirname(readme)));
    const command = values.command ?? r.command;
    if (!command) fail('no run command found in the README: pass --command "<cmd>"');

    let lines, source;
    if (values.live) {
        // Package runners fetch what they run, so they run outside the repo: inside a package's own repo, npx looks for its unbuilt local bin.
        const cwd = /^(npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run)\s/.test(command) ? tmpdir() : dirname(readme);
        console.error(`running in a terminal: ${command}   (in ${cwd})`);
        const { raw, status } = runLive(command, cwd);
        lines = trim(parseAnsi(raw));
        if (status !== 0) fail(`\`${command}\` exited ${status}, so there is nothing to show off. Its last lines:\n\n${
            lines.slice(-5).map(l => l.map(s => s.text).join('')).join('\n')}\n\nFix it, or pass --command "<cmd>"`);
        source = `ran       ${command} live: real output and colors. Review before publishing`;
    } else {
        lines = trim(r.output.map(text => [{ text }])); // README code blocks carry no colors, so none are added
        source = lines.length ? null : 'replayed  nothing: the README has no example output. Add one, or use --live';
    }
    const highlight = values.highlight ?? r.options.highlight;
    const hero = heroSvg({ title: r.title, tagline: r.tagline, command, lines, highlight });
    const shown = hero.shown.length < lines.length ? `${hero.shown.length - 1} of ${lines.length} lines (cut marked ⋮)` : `${lines.length} line${lines.length === 1 ? '' : 's'}`;
    source ??= `replayed  ${shown} of example output, as written (READMEs have no colors; --live runs it)`;
    if (highlight && !hero.highlighted) console.error(`highlight: no shown line contains "${highlight}"`);

    const t0 = Date.now();
    if (gif) { try { await renderGif(hero, out); } catch (e) { fail(e.message); } }
    else writeFileSync(out, hero.svg);
    const kb = statSync(out).size / 1024;
    const src = relative(dirname(readme), out).split('\\').join('/'), alt = [r.title, r.tagline].filter(Boolean).join(': ');
    const show = p => { const rel = relative(process.cwd(), p); return rel.startsWith('../../..') ? p : rel; }; // short paths stay relative
    console.log(`🤸 look what I can do!

  read      ${show(readme)}: ${r.title}
  block     ${r.marked ? 'the one marked hero' : 'guessed. Mark yours with ```console hero to be sure'}
  ${source}
  rendered  ${show(out)} · ${hero.W}×${hero.H} · ${hero.seconds.toFixed(1)} s loop · ${kb < 100 ? kb.toFixed(1) : Math.round(kb)} KB · in ${((Date.now() - t0) / 1000).toFixed(1)} s

Paste at the top of your README:

<p align="center">
  <img src="${esc(src)}" width="800" alt="${esc(alt)}">
</p>`);
}

// Run directly (`node lwicd.mjs`, or a bin: realpath because npx runs it through a .bin symlink), not imported.
// argv[1] may not be a file at all (node -e, some hosts), so a failed lookup means "imported".
export const runDirectly = url => { try { return realpathSync(process.argv[1]) === fileURLToPath(url); } catch { return false; } };
if (runDirectly(import.meta.url)) main().catch(e => { console.error(`look-what-i-can-do: ${e.message}`); process.exit(1); });
