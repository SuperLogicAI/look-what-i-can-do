// look-what-i-can-do, hosted: GET /<owner>/<repo>.svg renders a public repo's README as an animated hero.
// Runs as a Cloudflare Worker (the default export below) and locally via `node lwicd.mjs serve`. No Node imports: a test keeps it that way.
// README bytes only ever come from unauthenticated raw.githubusercontent.com fetches, so a private repo can't render even
// when GITHUB_TOKEN can see it. Camo URLs are public: a private README must never leak through one.
import { readReadme, heroSvg, trim, README_PATHS as PROBES, VERSION } from './render.mjs';

const RAW = 'https://raw.githubusercontent.com', API = 'https://api.github.com';
const CHECK_MS = 60_000, PATH_MS = 24 * 3600_000, MISS_MS = 10 * 60_000, MAX_BYTES = 500 * 1024, TIMEOUT_MS = 2500;
// Per instance: at most 500 repos, each keeping up to 200 output lines of up to 500 characters, well inside a Worker's 128 MB.
const MAX_REPOS = 500, MAX_LINES = 200, MAX_LINE = 500;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, REPO = /^(?!\.\.?$)[\w.-]{1,100}$/, SAFE = /^(?!\/)(?!.*\.\.)[\w.\-/]{1,200}$/;
const MARKDOWN = /\.(md|markdown|mdown|mkdn)$/i;

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
const sha256 = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

// Errors are 200s: camo shows any other status as a broken image. The error code rides in a header for our own monitoring.
function errorResponse(code, name) {
    const [what, fix] = ERRORS[code];
    const { svg } = heroSvg({ title: name ?? 'look-what-i-can-do 🤸', tagline: 'look-what-i-can-do could not render this README',
        command: `look-what-i-can-do ${name ?? '<owner>/<repo>'}`, lines: [[{ text: `✗ ${what}`, fg: 1 }], [{ text: `  ${fix}`, dim: true }]] });
    return new Response(svg, { headers: { ...SVG_HEADERS, 'x-lwicd-error': code } });
}

const usage = origin => `look-what-i-can-do ${VERSION}, hosted: an animated hero for any public repo's README.

  GET /<owner>/<repo>.svg              the README GitHub shows on the repo page
      ?path=packages/cli/README.md     another README (monorepos)
      ?ref=next                        a branch or tag
      ?highlight=text                  sweep a highlight over the first output line containing text

Embed: <img src="${origin}/<owner>/<repo>.svg" width="800" alt="...">
README edits show up within about 7 minutes. Private repos are never served.
`;

/** A fetch-style handler for GET /<owner>/<repo>.svg. fetch, token and clock are injectable for tests. */
export function createHandler({ fetch = globalThis.fetch, token = globalThis.process?.env?.GITHUB_TOKEN, now = Date.now } = {}) {
    const repos = new Map(); // "owner/repo@ref:path" → { path, pathAt, etag, hash, readme, checkedAt, error, inflight, render }
    const entry = key => {
        let e = repos.get(key);
        if (!e) {
            // ponytail: in-memory per instance, oldest repo evicted first; share through the Cache API or KV when instances multiply
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
        // No README yet: look again after 10 minutes, not a day. Not every minute: without a token the API allows 60 an hour.
        if (!pathParam && (e.path === undefined || now() - e.pathAt > (e.path ? PATH_MS : MISS_MS))) { e.path = await locate(owner, repo, ref); e.pathAt = now(); }
        const path = pathParam ?? e.path;
        if (!path) throw new Fail('not-found');
        if (!MARKDOWN.test(path)) throw new Fail('not-markdown');
        // Only revalidate what we still hold: a 304 for a README we dropped (private, then public again) would leave nothing to serve.
        const r = await get(rawUrl(owner, repo, ref, path), e.etag && e.readme ? { 'if-none-match': e.etag } : {});
        if (r.status === 304) return; // raw's ETag follows the README's content, so unrelated commits land here
        if (!r.ok) {
            await r.body?.cancel();
            if (r.status !== 404) throw new Fail('upstream');
            Object.assign(e, { readme: null, render: null, etag: null }); // gone from here: never serve it again, even if the lookup below fails
            if (!pathParam && !e.relocated) { e.path = undefined; e.relocated = true; return refresh(e, owner, repo, ref, pathParam); } // moved? look again once
            throw new Fail('not-found');
        }
        const reader = r.body.getReader(), chunks = [];
        for (let n = 0; n < MAX_BYTES;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
        reader.cancel().catch(() => {}); // GitHub shows the first 500 KiB too
        const bytes = new Uint8Array(await new Blob(chunks).slice(0, MAX_BYTES).arrayBuffer());
        const readme = readReadme(new TextDecoder().decode(bytes), repo);
        // ponytail: example output past 200 lines is cut before rendering, so ⋮ and the kept footer come from those 200
        readme.output = readme.output.slice(0, MAX_LINES).map(l => l.slice(0, MAX_LINE));
        Object.assign(e, { etag: r.headers.get('etag'), hash: await sha256(bytes), readme, render: null, relocated: false });
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
        if (url.pathname === '/') return new Response(usage(url.origin), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
        const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\.svg$/);
        if (!m) return url.pathname.endsWith('.svg') ? errorResponse('bad-request') // anything embedded as an image gets an image
            : new Response('Not found. Try /<owner>/<repo>.svg\n', { status: 404 });
        const [, owner, repo] = m, q = url.searchParams;
        const ref = q.get('ref') ?? '', path = q.get('path'), highlight = q.get('highlight') ?? undefined;
        if (!OWNER.test(owner) || !REPO.test(repo) || (ref && !SAFE.test(ref)) || (path !== null && !SAFE.test(path)) || highlight?.length > 100)
            return errorResponse('bad-request');
        const name = `${owner}/${repo}`;
        try {
            const e = await fresh(`${name}@${ref}:${path ?? ''}`, owner, repo, ref, path);
            const tag = `"${(await sha256(`${e.hash}\0${VERSION}\0${highlight ?? ''}`)).slice(0, 32)}"`;
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

// Cloudflare Worker entry. GITHUB_TOKEN, if set, is a Worker secret with public-repo read access only: it just raises the lookup limit.
// Browsers asking for / get the landing page (site/index.html, a static asset); curl and friends keep the plain-text usage.
let worker;
const wantsPage = request => new URL(request.url).pathname === '/' && request.headers.get('accept')?.includes('text/html');
export default { fetch: (request, env = {}) => env.ASSETS && wantsPage(request) ? env.ASSETS.fetch(request)
    : (worker ??= createHandler({ token: env.GITHUB_TOKEN }))(request) };
