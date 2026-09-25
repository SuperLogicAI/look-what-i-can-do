#!/usr/bin/env node
// look-what-i-can-do: README in, animated hero out. See PROPOSAL.md.
// Writes an animated SVG (the primary output) or, with --gif, a GIF export of the same SVG.
// Replay (default) animates the command and example output the README already shows, and runs nothing from the repo.
// --live runs the command in a pseudo-terminal and keeps its real output and colors.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { VERSION, readReadme, parseAnsi, trim, heroSvg, esc } from './render.mjs';
import { createHandler } from './serve.mjs';

export * from './render.mjs'; // the renderer, for tests and anyone importing the CLI module

const FPS = 15;

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
       look-what-i-can-do serve [--port 8787]    the hosted URL, locally: /<owner>/<repo>.svg

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
            live: { type: 'boolean' }, command: { type: 'string' }, highlight: { type: 'string' }, port: { type: 'string' },
            help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } } }));
    } catch (e) { fail(`${e.message}\n\n${usage}`); }
    if (values.help) return console.log(usage);
    if (values.version) return console.log(VERSION);
    if (positionals[0] === 'serve') return serveLocally(Number(values.port ?? 8787));
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

/** The hosted handler (serve.mjs) behind a plain Node HTTP server. In production it runs as a Cloudflare Worker. */
function serveLocally(port, handle = createHandler()) {
    createServer(async (req, res) => {
        try {
            const inm = req.headers['if-none-match'];
            const response = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: inm ? { 'if-none-match': inm } : {} }));
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
        } catch (e) { res.writeHead(500).end(String(e.message)); }
    }).listen(port, () => console.log(`look-what-i-can-do: http://localhost:${port}/<owner>/<repo>.svg`));
}

// Run directly (`node lwicd.mjs`, or a bin: realpath because npx runs it through a .bin symlink), not imported.
// argv[1] may not be a file at all (node -e, some hosts), so a failed lookup means "imported".
const runDirectly = url => { try { return realpathSync(process.argv[1]) === fileURLToPath(url); } catch { return false; } };
if (runDirectly(import.meta.url)) main().catch(e => { console.error(`look-what-i-can-do: ${e.message}`); process.exit(1); });
