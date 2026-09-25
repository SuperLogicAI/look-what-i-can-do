// The hosted URL against a fake GitHub: freshness, README lookup, errors, privacy. Synthetic data only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker, { createHandler } from './serve.mjs';

const fence = '```';
const readme = (out = 'all 9 checks passed') => ['# tool', '', 'Does a thing.', '', `${fence}console`, '$ npx tool', out, fence].join('\n');

// raw.githubusercontent.com (content ETags, 304s, HEAD probes) and the /readme API, over an editable file map "owner/repo/path".
function fakeGitHub(files, { api = 'ok', delay = 0 } = {}) {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const u = new URL(url), method = init.method ?? 'GET';
        calls.push(`${method} ${u.host === 'api.github.com' ? 'api' : 'raw'} ${decodeURIComponent(u.pathname)}`);
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (api === 'down' && u.host === 'api.github.com') throw new Error('network');
        if (u.host === 'api.github.com') {
            if (api === 'limited') return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
            const [, , owner, repo] = u.pathname.split('/');
            const shown = ['.github/README.md', 'README.md', 'docs/README.md', 'README.rst'].find(p => `${owner}/${repo}/${p}` in files);
            return shown ? Response.json({ path: shown }) : new Response('{}', { status: 404 });
        }
        const [, owner, repo, , ...path] = u.pathname.split('/');
        const body = files[`${owner}/${repo}/${path.map(decodeURIComponent).join('/')}`];
        if (body === undefined) return new Response('404: Not Found', { status: 404 });
        const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
        if (init.headers?.['if-none-match'] === etag) return new Response(null, { status: 304, headers: { etag } });
        return new Response(method === 'HEAD' ? null : body, { headers: { etag } });
    };
    return { fetch, calls };
}
const clock = () => { const c = { t: 1e12 }; c.now = () => c.t; return c; };
const req = (path, headers = {}) => new Request(`http://localhost${path}`, { headers });

test('serves the README as an SVG with no-cache and an ETag; If-None-Match gets a 304', async () => {
    const gh = fakeGitHub({ 'acme/tool/README.md': readme() });
    const handle = createHandler({ fetch: gh.fetch, now: clock().now });
    const r = await handle(req('/acme/tool.svg'));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(await r.text(), /^<svg [\s\S]*>all 9 checks passed</);
    const again = await handle(req('/acme/tool.svg', { 'if-none-match': r.headers.get('etag') }));
    assert.equal(again.status, 304);
    assert.equal(await again.text(), '');
});

test('checks GitHub at most once a minute; an edit shows after that; unchanged READMEs revalidate with a 304', async () => {
    const files = { 'acme/tool/README.md': readme() }, gh = fakeGitHub(files), c = clock();
    const handle = createHandler({ fetch: gh.fetch, now: c.now });
    const first = (await handle(req('/acme/tool.svg'))).headers.get('etag');
    const calls = gh.calls.length;
    files['acme/tool/README.md'] = readme('all 10 checks passed');
    c.t += 30_000;
    assert.equal((await handle(req('/acme/tool.svg'))).headers.get('etag'), first);
    assert.equal(gh.calls.length, calls, 'no GitHub call inside the minute');
    c.t += 31_000;
    const edited = await handle(req('/acme/tool.svg'));
    assert.notEqual(edited.headers.get('etag'), first);
    assert.match(await edited.text(), />all 10 checks passed</);
    c.t += 61_000;
    await handle(req('/acme/tool.svg'));
    assert.match(gh.calls.at(-1), /^GET raw /);
    assert.equal(gh.calls.filter(x => x.startsWith('GET api')).length, 1, 'the README path is looked up once a day, not per check');
});

test('finds the README GitHub shows: .github/ before the root; probes raw in that order when the API is limited', async () => {
    const files = { 'acme/tool/.github/README.md': readme('from .github'), 'acme/tool/README.md': readme('from root') };
    for (const api of ['ok', 'limited', 'down']) {
        const svg = await (await createHandler({ fetch: fakeGitHub(files, { api }).fetch, now: clock().now })(req('/acme/tool.svg'))).text();
        assert.match(svg, />from \.github</, api);
    }
    const mono = fakeGitHub({ 'acme/mono/packages/cli/README.md': readme('from the package') });
    const svg = await (await createHandler({ fetch: mono.fetch, now: clock().now })(req('/acme/mono.svg?path=packages/cli/README.md'))).text();
    assert.match(svg, />from the package</);
    assert.ok(!mono.calls.some(x => x.includes('api')), '?path= skips the lookup');
});

test('errors are 200 SVGs with a code in a header, never broken images', async () => {
    const gh = fakeGitHub({ 'acme/rst/README.rst': 'Title\n=====', 'acme/empty/README.md': '# empty\n\nNo commands here.' });
    const handle = createHandler({ fetch: gh.fetch, now: clock().now });
    for (const [path, code] of [['/acme/missing.svg', 'not-found'], ['/acme/rst.svg', 'not-markdown'], ['/acme/empty.svg', 'nothing'],
        ['/acme/tool.svg?path=../../etc/passwd', 'bad-request'], ['/-acme/tool.svg', 'bad-request'], ['/acme/..%2Fetc.svg', 'bad-request'],
        ['/etc.svg', 'bad-request'], ['/a/b/c.svg', 'bad-request']]) {
        const r = await handle(req(path));
        assert.equal(r.status, 200, path);
        assert.equal(r.headers.get('x-lwicd-error'), code, path);
        assert.match(await r.text(), /^<svg /, path);
    }
    assert.ok(!gh.calls.some(x => x.includes('etc')), 'bad requests never reach GitHub');
    const down = createHandler({ fetch: async () => { throw new Error('network'); }, now: clock().now });
    assert.equal((await down(req('/acme/tool.svg'))).headers.get('x-lwicd-error'), 'upstream');
});

test('private stays private: a README only a token can see is not served, and a repo that goes private stops serving', async () => {
    // The API (with a token) can see this repo's README; unauthenticated raw can't, and raw is the only source of README bytes.
    const hidden = createHandler({ fetch: async (url, init) => url.includes('api.github.com') ? Response.json({ path: 'README.md' })
        : new Response('404: Not Found', { status: 404 }), token: 'test-token', now: clock().now });
    assert.equal((await hidden(req('/acme/secret.svg'))).headers.get('x-lwicd-error'), 'not-found');
    const files = { 'acme/tool/README.md': readme() }, c = clock();
    const handle = createHandler({ fetch: fakeGitHub(files).fetch, now: c.now });
    assert.equal((await handle(req('/acme/tool.svg'))).status, 200);
    delete files['acme/tool/README.md']; // made private
    c.t += 61_000;
    const gone = await handle(req('/acme/tool.svg'));
    assert.equal(gone.headers.get('x-lwicd-error'), 'not-found');
    assert.doesNotMatch(await gone.text(), /all 9 checks passed/);
});

test('when GitHub fails after a good render, serves that render marked stale', async () => {
    const gh = fakeGitHub({ 'acme/tool/README.md': readme() }), c = clock();
    let broken = false;
    const handle = createHandler({ fetch: (u, i) => broken ? Promise.reject(new Error('timeout')) : gh.fetch(u, i), now: c.now });
    const good = await handle(req('/acme/tool.svg'));
    broken = true; c.t += 61_000;
    const stale = await handle(req('/acme/tool.svg'));
    assert.equal(stale.headers.get('x-lwicd-stale'), '1');
    assert.equal(stale.headers.get('etag'), good.headers.get('etag'));
});

test('requests that arrive together share one GitHub fetch', async () => {
    const gh = fakeGitHub({ 'acme/tool/README.md': readme() }, { delay: 20 });
    const handle = createHandler({ fetch: gh.fetch, now: clock().now });
    const all = await Promise.all(Array.from({ length: 5 }, () => handle(req('/acme/tool.svg'))));
    assert.ok(all.every(r => r.status === 200));
    assert.deepEqual(gh.calls, ['GET api /repos/acme/tool/readme', 'GET raw /acme/tool/HEAD/README.md']);
});

test('the hosted code is Worker-safe: no Node imports, and the default export answers as a Worker', async () => {
    for (const f of ['serve.mjs', 'render.mjs']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /from\s+['"]node:|require\(/, f);
    const r = await worker.fetch(new Request('https://lookwhaticando.dev/'), {});
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Embed: <img src="https:\/\/lookwhaticando\.dev\/<owner>\/<repo>\.svg"/);
});

test('?highlight and the README comment both highlight; a highlight changes the ETag', async () => {
    const files = { 'acme/tool/README.md': readme(), 'acme/lit/README.md': `<!-- look-what-i-can-do highlight="9 checks" -->\n${readme()}` };
    const handle = createHandler({ fetch: fakeGitHub(files).fetch, now: clock().now });
    const plain = await handle(req('/acme/tool.svg')), lit = await handle(req('/acme/tool.svg?highlight=9%20checks'));
    assert.doesNotMatch(await plain.text(), /class="a g"/);
    assert.match(await lit.text(), /class="a g"/);
    assert.notEqual(plain.headers.get('etag'), lit.headers.get('etag'));
    assert.match(await (await handle(req('/acme/lit.svg'))).text(), /class="a g"/);
});
