#!/usr/bin/env node
// look-what-i-can-do, hosted: GET /<owner>/<repo>.svg renders a public repo's README as an animated hero. PROPOSAL §3.4.
// README bytes only ever come from unauthenticated raw.githubusercontent.com fetches, so a private repo can't render even
// when GITHUB_TOKEN can see it. Camo URLs are public: a private README must never leak through one.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { readReadme, heroSvg, trim, runDirectly, VERSION } from './lwicd.mjs';

const RAW = 'https://raw.githubusercontent.com', API = 'https://api.github.com';
const CHECK_MS = 60_000, PATH_MS = 24 * 3600_000, MAX_BYTES = 500 * 1024, TIMEOUT_MS = 2500, MAX_REPOS = 1000;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, REPO = /^(?!\.\.?$)[\w.-]{1,100}$/, SAFE = /^(?!\/)(?!.*\.\.)[\w.\-/]{1,200}$/;
const MARKDOWN = /\.(md|markdown|mdown|mkdn)$/i;
// GitHub shows the first README it finds in .github/, then the root, then docs/.
const PROBES = ['.github/', '', 'docs/'].flatMap(dir => ['README.md', 'readme.md', 'Readme.md'].map(name => dir + name));

class Fail extends Error { constructor(code) { super(code); this.code = code; } }
const ERRORS = {
    'bad-request': ['That URL is not a repo.', 'Use /<owner>/<repo>.svg, with optional ?path=, ?ref= and ?highlight='],
    'not-found': ['No public README here.', 'Private repos are never served: image URLs are public. Use the CLI or the GitHub Action.'],
    'not-markdown': ['The README is not Markdown.', 'Only Markdown READMEs can be read for now.'],
    nothing: ['Found the README, but nothing to animate.', 'Add a block fenced ```console hero with a $ command and its output.'],
    upstream: ['GitHub did not answer in time.', 'This image tries again on the next view.'],
};
const SVG_HEADERS = { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache', // GitHub's documented camo setting
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' };

// Errors are 200s: camo shows any other status as a broken image. The error code rides in a header for our own monitoring.
function errorResponse(code, name) {
    const [what, fix] = ERRORS[code];
    const { svg } = heroSvg({ title: name ?? 'look-what-i-can-do 🤸', tagline: 'look-what-i-can-do could not render this README',
        command: `look-what-i-can-do ${name ?? '<owner>/<repo>'}`, lines: [[{ text: `✗ ${what}`, fg: 1 }], [{ text: `  ${fix}`, dim: true }]] });
    return new Response(svg, { headers: { ...SVG_HEADERS, 'x-lwicd-error': code } });
}

/** A fetch-style handler for GET /<owner>/<repo>.svg. fetch, token and clock are injectable for tests. */
export function createHandler({ fetch = globalThis.fetch, token = process.env.GITHUB_TOKEN, now = Date.now } = {}) {
    const repos = new Map(); // "owner/repo@ref:path" → { path, pathAt, etag, hash, readme, checkedAt, error, inflight, render }
    const entry = key => {
        let e = repos.get(key);
        if (!e) {
            // ponytail: in-memory per instance, oldest repo evicted first; move to a shared KV when one instance isn't enough
            if (repos.size >= MAX_REPOS) repos.delete(repos.keys().next().value);
            repos.set(key, e = {});
        }
        return e;
    };
    const get = (url, headers = {}, method = 'GET') =>
        fetch(url, { method, headers: { 'user-agent': `look-what-i-can-do/${VERSION}`, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const segments = s => s.split('/').map(encodeURIComponent).join('/');
    const rawUrl = (owner, repo, ref, path) => `${RAW}/${owner}/${repo}/${ref ? segments(ref) : 'HEAD'}/${segments(path)}`;

    // The README GitHub displays: one API call per repo per day. Rate-limited or unreachable: probe raw in GitHub's order.
    async function locate(owner, repo, ref) {
        try {
            const r = await get(`${API}/repos/${owner}/${repo}/readme${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
                { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) });
            if (r.ok) return (await r.json()).path;
            await r.body?.cancel();
            if (r.status === 404) return null;
        } catch { /* fall through to probing */ }
        const seen = await Promise.all(PROBES.map(p => get(rawUrl(owner, repo, ref, p), {}, 'HEAD')
            .then(r => r.ok ? 'hit' : r.status === 404 ? 'miss' : 'error', () => 'error')));
        // The first answer that isn't a clean 404 decides, in GitHub's order. GitHub trouble is not "no README".
        const first = seen.findIndex(s => s !== 'miss');
        if (first >= 0 && seen[first] === 'error') throw new Fail('upstream');
        return PROBES[first] ?? null;
    }

    async function refresh(e, owner, repo, ref, pathParam) {
        if (!pathParam && (e.path === undefined || now() - e.pathAt > PATH_MS)) { e.path = await locate(owner, repo, ref); e.pathAt = now(); }
        const path = pathParam ?? e.path;
        if (!path) throw new Fail('not-found');
        if (!MARKDOWN.test(path)) throw new Fail('not-markdown');
        const r = await get(rawUrl(owner, repo, ref, path), e.etag ? { 'if-none-match': e.etag } : {});
        if (r.status === 304) return; // raw's ETag follows the README's content, so unrelated commits land here
        if (!r.ok) {
            await r.body?.cancel();
            if (r.status !== 404) throw new Fail('upstream');
            if (!pathParam && !e.relocated) { e.path = undefined; e.relocated = true; return refresh(e, owner, repo, ref, pathParam); } // moved? look again once
            throw new Fail('not-found');
        }
        const chunks = [];
        let n = 0;
        for await (const c of r.body) { chunks.push(c); if ((n += c.length) >= MAX_BYTES) break; } // GitHub shows the first 500 KiB too
        const bytes = Buffer.concat(chunks).subarray(0, MAX_BYTES);
        Object.assign(e, { etag: r.headers.get('etag'), hash: createHash('sha256').update(bytes).digest('hex'),
            readme: readReadme(new TextDecoder().decode(bytes), repo), render: null, relocated: false });
    }

    // At most one GitHub check per repo per minute, shared by every request that arrives meanwhile. Errors are cached as long.
    async function fresh(key, owner, repo, ref, path) {
        const e = entry(key);
        if (now() - (e.checkedAt ?? -Infinity) >= CHECK_MS) {
            e.inflight ??= refresh(e, owner, repo, ref, path)
                .then(() => { e.error = null; }, err => { e.error = err instanceof Fail ? err : new Fail('upstream'); })
                .finally(() => { e.checkedAt = now(); e.inflight = null; });
            await e.inflight;
        }
        if (e.error && e.error.code !== 'upstream') { e.readme = e.render = null; throw e.error; } // gone, private or moved: stop serving it
        if (!e.readme) throw e.error ?? new Fail('upstream');
        e.stale = !!e.error; // GitHub trouble: serve the last good README
        return e;
    }

    return async function handle(request) {
        const url = new URL(request.url);
        if (url.pathname === '/') return new Response(USAGE, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
        const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\.svg$/);
        if (!m) return new Response('Not found. Try /<owner>/<repo>.svg\n', { status: 404 });
        const [, owner, repo] = m, q = url.searchParams;
        const ref = q.get('ref') ?? '', path = q.get('path'), highlight = q.get('highlight') ?? undefined;
        if (!OWNER.test(owner) || !REPO.test(repo) || (ref && !SAFE.test(ref)) || (path !== null && !SAFE.test(path)) || highlight?.length > 100)
            return errorResponse('bad-request');
        const name = `${owner}/${repo}`;
        try {
            const e = await fresh(`${name}@${ref}:${path ?? ''}`, owner, repo, ref, path);
            const tag = `"${createHash('sha256').update(`${e.hash}\0${VERSION}\0${highlight ?? ''}`).digest('hex').slice(0, 32)}"`;
            if (e.render?.tag !== tag) {
                const r = e.readme;
                if (!r.command) throw new Fail('nothing');
                const { svg } = heroSvg({ title: r.title, tagline: r.tagline, command: r.command,
                    lines: trim(r.output.map(text => [{ text }])), highlight: highlight ?? r.options.highlight });
                e.render = { tag, svg };
            }
            const headers = { ...SVG_HEADERS, etag: tag, ...(e.stale && { 'x-lwicd-stale': '1' }) };
            if (request.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers });
            return new Response(e.render.svg, { headers });
        } catch (err) {
            return errorResponse(err instanceof Fail ? err.code : 'upstream', name);
        }
    };
}

const USAGE = `look-what-i-can-do ${VERSION}, hosted: an animated hero for any public repo's README.

  GET /<owner>/<repo>.svg              the README GitHub shows on the repo page
      ?path=packages/cli/README.md     another README (monorepos)
      ?ref=next                        a branch or tag
      ?highlight=text                  sweep a highlight over the first output line containing text

Embed: <img src="https://<this host>/<owner>/<repo>.svg" width="800" alt="...">
README edits show up within about 6 minutes. Private repos are never served.
`;

/** The handler behind a plain Node HTTP server. */
export function serve(port, handle = createHandler()) {
    return createServer(async (req, res) => {
        try {
            const inm = req.headers['if-none-match'];
            const response = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers: inm ? { 'if-none-match': inm } : {} }));
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
        } catch (e) { res.writeHead(500).end(String(e.message)); }
    }).listen(port);
}

// `node serve.mjs [--port 8787]`
if (runDirectly(import.meta.url)) {
    const { values } = parseArgs({ options: { port: { type: 'string', default: '8787' } } });
    serve(Number(values.port)).on('listening', () => console.log(`look-what-i-can-do: http://localhost:${values.port}/<owner>/<repo>.svg`));
}
