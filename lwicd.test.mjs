// Fixture tests for README reading, terminal parsing, the SVG writer and the no-cap rules. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readReadme, fillHero, parseAnsi, fit, trim, layout, heroSvg, hex, runLive } from './lwicd.mjs';

const fence = '```';
const L = s => s.split('\n').map(text => [{ text }]);
const text = lines => lines.map(l => l.map(s => s.text).join(''));
const rows = svg => svg.match(/<text [^>]*class="a o"[^>]*>[\s\S]*?<\/text>/g) ?? []; // the output lines, not the frame around them
const cli = fileURLToPath(new URL('./lwicd.mjs', import.meta.url));

test('README: title, one-line tagline, run command without its comment, example output', () => {
    const md = ['<p align="center"><img src="logo.gif"></p>', '', '# demo_tool 🧪', '',
        '**Checks your `widgets`. Then checks them again.** Extra words that make this paragraph too long for a single line of hero.', '',
        `${fence}sh`, 'npx demo-tool --fast   # the quick way', fence, '',
        fence, 'Scanned 12 widgets.', '', 'All good.', fence].join('\n');
    assert.deepEqual(readReadme(md), { title: 'demo_tool 🧪', tagline: 'Checks your widgets. Then checks them again.',
        command: 'npx demo-tool --fast', output: ['Scanned 12 widgets.', '', 'All good.'], marked: false, options: {} });
});

test('README: a block fenced ```console hero wins over earlier blocks; a comment sets the highlight', () => {
    const md = ['# t', '', `${fence}console`, '$ npx t --help', 'usage: t', fence, '',
        '<!-- look-what-i-can-do highlight="3 fixed" -->', `${fence}console hero`, '$ npx t', 'scanned 9', '3 fixed', fence].join('\n');
    const r = readReadme(md);
    assert.equal(r.marked, true);
    assert.equal(r.command, 'npx t');
    assert.deepEqual(r.output, ['scanned 9', '3 fixed']);
    assert.deepEqual(r.options, { highlight: '3 fixed' });
});

test('README: an options comment shown inside a code block is documentation, not configuration', () => {
    const md = ['# t', '', `${fence}html`, '<!-- look-what-i-can-do highlight="example" -->', fence, '', `${fence}console hero`, '$ npx t', 'ok', fence].join('\n');
    assert.deepEqual(readReadme(md).options, {});
});

test('README: a marked block with no prompt is the output; the command comes from the shell blocks', () => {
    const md = ['# t', '', `${fence}sh`, 'npx t', fence, '', `${fence}text hero`, 'all 4 green', fence].join('\n');
    const r = readReadme(md);
    assert.equal(r.command, 'npx t');
    assert.deepEqual(r.output, ['all 4 green']);
});

test('README: a console block pairs "$ command" with its output, up to the next prompt', () => {
    const md = ['# t', '', `${fence}console`, '$ npx t', 'hello', '', 'bye', '$ npx t --help', 'ignored', fence].join('\n');
    const r = readReadme(md);
    assert.equal(r.command, 'npx t');
    assert.deepEqual(r.output, ['hello', '', 'bye']);
});

test('README: no heading falls back to the folder name; config blocks are not output', () => {
    const r = readReadme(['Some intro.', '', `${fence}json`, '{"a":1}', fence].join('\n'), 'my-folder');
    assert.equal(r.title, 'my-folder');
    assert.deepEqual(r.output, []);
    assert.equal(r.command, '');
});

test('fillHero: replaces only the marked block\'s output, up to the next prompt; refuses when it can\'t do that safely', () => {
    const md = ['# t', '', `${fence}console`, '$ npx t --help', 'untouched', fence, '', `${fence}console hero`, '$ npx t', 'old 1', 'old 2',
        '$ npx t --version', '1.0.0', fence, '', 'after'].join('\n');
    assert.equal(fillHero(md, ['new']), md.replace('old 1\nold 2', 'new'));
    assert.equal(readReadme(fillHero(md, ['a', '', 'b'])).output.join('|'), 'a||b');
    assert.throws(() => fillHero('# t\n\nno blocks', ['x']), /no block fenced ```console hero/);
    assert.throws(() => fillHero(`${fence}console hero\nno prompt\n${fence}`, ['x']), /needs a "\$ command" line/);
    assert.throws(() => fillHero(`${fence}console hero\n$ npx t\n${fence}`, ['```js']), /would end the code block/);
});

test('ANSI: 16, 256 and 24-bit colors, dim, OSC links, carriage returns and the script ^D echo', () => {
    const lines = parseAnsi('^D\b\b\x1b[32mgreen\x1b[0m plain\r\n\x1b[1;38;2;0;208;155m/\x1b[0m\x1b[2mdim\x1b[0m\r\n'
        + 'loading...\rdone\n\x1b]8;;https://example.com\x07link\x1b]8;;\x07 \x1b[38;5;208morange\x1b[0m\x1b[?25l');
    assert.deepEqual(lines[0], [{ text: 'green', fg: 2 }, { text: ' plain' }]);
    assert.deepEqual(lines[1], [{ text: '/', bold: true, fg: '#00d09b' }, { text: 'dim', dim: true }]);
    assert.deepEqual(lines[2], [{ text: 'done' }]);
    assert.deepEqual(lines[3], [{ text: 'link ' }, { text: 'orange', fg: 208 }]);
    assert.equal(hex(2), '#3fb950'); assert.equal(hex(43), '#00d7af'); assert.equal(hex(208), '#ff8700'); assert.equal(hex(244), '#808080');
});

test('ANSI: a spinner that redraws with ESC[1G ESC[0K leaves only what it made way for', () => {
    // npx prints exactly this while it fetches, and once more after the output.
    const spin = c => `${c}\x1b[1G\x1b[0K`;
    assert.deepEqual(trim(parseAnsi(`${spin('⠙')}${spin('⠹')}0.2.0\r\n${spin('⠙')}`)), [[{ text: '0.2.0' }]]);
    assert.deepEqual(parseAnsi('50%\x1b[2K100%'), [[{ text: '100%' }]]);
});

test('fit: keeps top blocks and the footer block, marks the cut with ⋮, never exceeds max', () => {
    const lines = L('a1\na2\n\nb1\nb2\nb3\n\nc1\nc2\n\nfooter');
    assert.equal(fit(lines, 11), lines);
    assert.deepEqual(text(fit(lines, 9)), ['a1', 'a2', '', 'b1', 'b2', 'b3', '⋮', '', 'footer']);
    for (let max = 5; max < 11; max++) {
        const f = text(fit(lines, max));
        assert.ok(f.length <= max, `max ${max}: ${f.length} lines`);
        assert.equal(f.at(-1), 'footer', `max ${max} lost the footer`);
        assert.ok(f.includes('⋮'), `max ${max} cut without a mark`);
    }
    assert.deepEqual(text(trim(L('\n\nx\n\n'))), ['x']);
});

test('layout: long output grows the canvas, then cuts with a mark; wide lines shrink the font', () => {
    const short = layout(L('one\ntwo'), 'npx t');
    assert.equal(short.H, 640); assert.equal(short.font, 16);
    const long = layout(L(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')), 'npx t');
    assert.ok(long.H > 900 && long.H <= 960, `height ${long.H}`);
    assert.ok(text(long.shown).includes('⋮'));
    assert.ok(layout(L('x'.repeat(150)), 'npx t').font < 16);
});

test('no cap: replay adds no colors to output; live keeps the colors it captured', () => {
    const replay = heroSvg({ title: 't', tagline: '', command: 'npx t', lines: L('backed 175 (79%)\nunbacked 32 (14%)') });
    assert.equal(rows(replay.svg).length, 2);
    for (const row of rows(replay.svg)) assert.doesNotMatch(row, /fill=/);
    const live = rows(heroSvg({ title: 't', tagline: '', command: 'npx t', lines: parseAnsi('\x1b[32m175\x1b[0m \x1b[33m32\x1b[0m') }).svg).join('');
    assert.match(live, /<tspan fill="#3fb950">175<\/tspan>/);
    assert.match(live, /<tspan fill="#d29922">32<\/tspan>/);
});

test('svg: escapes README text, expands tabs, keeps every element on one loop, goes still under reduced motion', () => {
    const { svg } = heroSvg({ title: '<b>"x"</b>', tagline: 'a & b', command: 'npx x', lines: L('a\tb\nok') });
    assert.match(svg, /aria-label="&lt;b&gt;&quot;x&quot;&lt;\/b&gt;: a &amp; b"/);
    assert.match(svg, /class="a t"[^>]*>&lt;b&gt;&quot;x&quot;&lt;\/b&gt;<\/text>/);
    assert.match(rows(svg)[0], />a {7}b</);
    for (const rule of svg.match(/@keyframes [^\n]*/g)) {
        const stops = [...rule.matchAll(/([\d.]+)%/g)].map(m => +m[1]);
        assert.deepEqual(stops, [...stops].sort((p, q) => p - q), rule);
        assert.ok(stops[0] === 0 && stops.at(-1) === 100, rule);
    }
    assert.match(svg, /@media \(prefers-reduced-motion:reduce\)\{\.a\{animation:none\}/);
});

test('svg: a line too wide even at the smallest font is cut with …, not run off the frame', () => {
    const row = rows(heroSvg({ title: 't', tagline: '', command: 'npx t', lines: L('y'.repeat(300)) }).svg)[0];
    assert.match(row, />y{164}…</); // 11px font: 1090px / 6.6px = 165 columns, the last one for …
});

test('svg: the same README and renderer version always give the same bytes', () => {
    const make = () => heroSvg({ title: 'agent-nocap 🧢', tagline: 'Was that cap?', command: 'npx agent-nocap', lines: parseAnsi('\x1b[32m179\x1b[0m backed\n\nfooter') }).svg;
    assert.equal(make(), make());
});

test('hero: highlight only when asked, and says when it found nothing', () => {
    const plainHero = heroSvg({ title: 't', tagline: '', command: 'npx t', lines: L('ok\nwarn') });
    assert.equal(plainHero.highlighted, false);
    assert.doesNotMatch(plainHero.svg, /class="a g"/);
    const lit = heroSvg({ title: 't', tagline: '', command: 'npx t', lines: L('ok\nwarn'), highlight: 'warn' });
    assert.equal(lit.highlighted, true);
    assert.match(lit.svg, /<rect [^>]*class="a g"/);
    assert.equal(heroSvg({ title: 't', tagline: '', command: 'npx t', lines: L('ok'), highlight: 'nope' }).highlighted, false);
});

test('cli: writes an SVG with no browser and prints the snippet; refuses other formats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lwicd-test-'));
    writeFileSync(join(dir, 'README.md'), ['# demo', '', 'Does a thing.', '', `${fence}console`, '$ npx demo', 'done in 1 s', fence].join('\n'));
    const r = spawnSync(process.execPath, [cli, '-o', 'hero.svg'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const svg = readFileSync(join(dir, 'hero.svg'), 'utf8');
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.match(svg, />done in 1 s</);
    assert.match(r.stdout, /<img src="hero\.svg" width="800" alt="demo: Does a thing\.">/);
    assert.match(r.stdout, /block {5}guessed\. Mark yours with ```console hero/);
    writeFileSync(join(dir, 'MARKED.md'), ['# demo', '', '<!-- look-what-i-can-do highlight="done" -->', `${fence}console hero`, '$ npx demo', 'done in 1 s', fence].join('\n'));
    const m = spawnSync(process.execPath, [cli, 'MARKED.md', '-o', 'marked.svg'], { cwd: dir, encoding: 'utf8' });
    assert.match(m.stdout, /block {5}the one marked hero/);
    assert.match(readFileSync(join(dir, 'marked.svg'), 'utf8'), /<rect [^>]*class="a g"/); // the comment's highlight

    for (const args of [['--gif', '-o', 'x.svg'], ['-o', 'x.png']]) {
        const bad = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
        assert.equal(bad.status, 2, args.join(' '));
        assert.match(bad.stderr, /output must be \.svg, or \.gif with --gif/);
        assert.ok(!existsSync(join(dir, args.at(-1))));
    }
});

test('cli: finds the README the way GitHub does, takes a folder, and says what to do when there is none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lwicd-find-'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'README.md'), ['# docs-only', '', `${fence}console hero`, '$ npx t', 'ok', fence].join('\n'));
    const inside = spawnSync(process.execPath, [cli, '-o', 'a.svg'], { cwd: dir, encoding: 'utf8' });
    assert.equal(inside.status, 0, inside.stderr);
    assert.match(inside.stdout, /read {6}docs\/README\.md: docs-only/);
    assert.equal(spawnSync(process.execPath, [cli, dir, '-o', join(dir, 'b.svg')], { encoding: 'utf8' }).status, 0);
    const none = spawnSync(process.execPath, [cli], { cwd: mkdtempSync(join(tmpdir(), 'lwicd-empty-')), encoding: 'utf8' });
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no README in .* \(looked in the folder, \.github\/ and docs\/\)\.\nRun it inside your repo/);
});

const hasScript = spawnSync('script', ['-h']).error?.code !== 'ENOENT';

test('live commands run in the README\'s folder; npx retries outside only after "command not found"', { skip: !hasScript && 'no script command' }, () => {
    // A fake npx: "own-tool" can't be found inside a repo (like agent-nocap in its own repo); everything reports where it ran.
    const bin = mkdtempSync(join(tmpdir(), 'lwicd-bin-'));
    writeFileSync(join(bin, 'npx'), '#!/bin/sh\nif [ "$1" = own-tool ] && [ -f ./README.md ]; then echo "sh: own-tool: command not found"; exit 127; fi\n'
        + 'if [ -f ./README.md ]; then echo "ran in the repo"; else echo "ran outside the repo"; fi\n');
    chmodSync(join(bin, 'npx'), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    for (const [tool, expected] of [['lister', 'ran in the repo'], ['own-tool', 'ran outside the repo']]) {
        const dir = mkdtempSync(join(tmpdir(), 'lwicd-cwd-'));
        writeFileSync(join(dir, 'README.md'), ['# t', '', `${fence}console hero`, `$ npx ${tool}`, 'placeholder', fence].join('\n'));
        const r = spawnSync(process.execPath, [cli, 'capture'], { cwd: dir, env, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), new RegExp(`\\$ npx ${tool}\\n${expected}\\n`), tool);
    }
});
test('capture: writes the command\'s real output into the marked block, colors dropped; a failing command changes nothing', { skip: !hasScript && 'no script command' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'lwicd-capture-'));
    const readme = join(dir, 'README.md');
    const md = ['# demo', '', `${fence}console hero`, `$ node -e "console.log('\\x1b[32m3 fixed\\x1b[0m'); console.log('done')"`, 'placeholder', fence, '', 'tail'].join('\n');
    writeFileSync(readme, md);
    const r = spawnSync(process.execPath, [cli, 'capture'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(readme, 'utf8'), md.replace('placeholder', '3 fixed\ndone'));
    const failing = md.replace(/\$ node -e .*/, '$ node -e "process.exit(3)"');
    writeFileSync(readme, failing);
    const bad = spawnSync(process.execPath, [cli, 'capture'], { cwd: dir, encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /exited 3; the README is unchanged/);
    assert.equal(readFileSync(readme, 'utf8'), failing);
});

test('live: a pseudo-terminal keeps colors a tool only prints to a TTY', { skip: !hasScript && 'no script command' }, () => {
    const { raw } = runLive(`node -e "console.log(process.stdout.isTTY ? '\\x1b[31mtty\\x1b[0m' : 'pipe')"`, process.cwd());
    assert.deepEqual(trim(parseAnsi(raw)), [[{ text: 'tty', fg: 1 }]]);
});
