# look-what-i-can-do: proposal (v2)

> 🤸 **Your README, as an animated hero. Zero setup from a URL.**
> Paste one `<img>` line and your README's own command and output play at the top of it: an animated SVG of a few KB, in full color, that re-renders when the README changes. The CLI does the same on your machine, adds `--live` for real terminal colors, and exports a GIF for X and LinkedIn.

Status: proposal v2, 2026-09-24, Super Logic AI. It was rewritten after two rounds of external review by a developer who built a profile-README generator. **Built:** the CLI, with animated SVG as the primary output, GIF export, and replay and live modes (`lwicd.mjs`); the ```` ```console hero ```` marker and options comment (§3.3); and the hosted URL handler (`serve.mjs`, §3.4), tested locally against real GitHub. See the [README](README.md). **Not built:** the deployment (it needs a go-ahead and a domain) and the GitHub Action. Measurements come from the founder's machine and from live requests to GitHub on 2026-09-24.

**North star (a target, not a claim):** the default way a repo gets its hero image. "Made with look-what-i-can-do" appears in more READMEs every week, and every one of those images shows output the tool can really produce.

---

## What changed from v1

| v1 | v2 | Why |
|---|---|---|
| GIF was the primary output, and a pure-JS GIF renderer was the Phase 1 build | Animated SVG is primary; GIF is an export | GIF has 256 colors, weighs 0.5–1 MB, and adds that much to Git history on every re-render. The same hero as SVG is 7.9 KB in full color, and it needs no rasterizer, which takes the hardest engineering off the critical path |
| The wedge was "no install" | The wedge is "zero setup from a URL" | It's the github-readme-stats model: paste one line, no npm, no commit |
| Hosted URL in Phase 3 | The hosted URL is the launch | It's the wedge |
| Heuristics decide what to animate | An invisible marker decides; heuristics are the fallback | A renderer that runs per request can't ask the author a question, so its output has to be deterministic |
| — | A fetch-and-cache contract | Freshness, varying README filenames, and private repos (§3.4) |

## TL;DR

- **Gap:** every launch wants a hero image, and making one means a detour through recorders, tape scripts, ffmpeg flags and oversized files. Recorders are popular (vhs 21k★, terminalizer 16k★) but need installing and scripting. The AI wrappers that exist haven't caught on: demo-gif-skill has 7★ and is in maintenance mode, screencli has 11★. It's the failure the nocap proposal saw with token-saver: good engineering with no zero-setup first run and no persona doesn't spread.
- **Product:** one renderer, three lanes. A **URL** (zero setup; replay only), the **CLI** (runs locally; `--live` for real colors; `--gif` export), and a **GitHub Action** (no server of ours; writes the SVG to an output branch).
- **Principle, "no cap":** the image never shows output the tool can't produce. The founder caught the first spike breaking this rule. Tests now enforce it.
- **Why it spreads:** the image lives inside READMEs, so every embed is seen by that repo's visitors. github-readme-stats (80k★) and readme-typing-svg (9.4k★) grew exactly this way. The command itself is the joke, and the tool's own hero is made by the tool.
- **For Super Logic AI:** launch images for agent-nocap and rentroll, material for posts, and a developer audience wider than agent users. It's a reach play, not a daily habit.

---

## 1. Evidence (2026-09-24)

| Check | Result |
|---|---|
| First spike, reviewed by the founder | "The numbers are all red; my real run shows red, yellow and green, and the //Super Logic AI footer is missing." The spike had invented a color and cut the footer. That led to the no-cap contract and `--live` |
| SVG vs GIF, same hero | nocap replay: **7.9 KB SVG vs 974 KB GIF**. nocap live: 8.6 KB vs 918 KB. This repo's hero: 9.5 KB vs 523 KB. The SVG writes in about 0 s; the GIF export takes about 3.5 s |
| SVG inside `<img>` (Chromium) | Valid and animated. The loop is exact: the hold frame is byte-identical one 8.57 s loop later, and 0.15 s into the second loop the frame is back to empty. Real ANSI colors and the dim footer come through |
| Camo (GitHub's image proxy) | Serves `image/svg+xml`. Its security policy is `default-src 'none'; img-src data:; style-src 'unsafe-inline'`, so CSS animation is allowed and scripts are blocked. The readme-typing-svg demo (9,886 B, animated, with a base64 `@font-face`) loads through it |
| Committed SVG | raw.githubusercontent serves `image/svg+xml` with `style-src 'unsafe-inline'`. The snake-game widget's 100 KB animated SVG ships this way |
| raw.githubusercontent behavior | The `HEAD` ref resolves the default branch. Paths are case-sensitive (`readme.md` returns 404). It caches for `max-age=300`. **The ETag depends only on content:** the same README at a commit that didn't touch it returns the same ETag. `If-None-Match` returns `304` with 0 bytes |
| GitHub REST API | 60 requests an hour without a token |
| Commit SHA without the API | `git ls-remote <repo> HEAD`: 0.9 s |
| GitHub docs | For stale camo images, serve `Cache-Control: no-cache`; as a last resort, `curl -X PURGE` the camo URL. README precedence is `.github/`, then root, then `docs/`. Content past 500 KiB is truncated |
| Hosted handler against real GitHub (run locally) | agent-nocap: 200 `image/svg+xml`, `no-cache`, an ETag, 7.9 KB, 1.1 s cold (one API call plus one raw fetch). Revalidation: `304` in 1 ms. `?highlight=`: 1 ms with a new ETag. The private rent_roll: a `200` error SVG coded `not-found`, with the same message a missing repo gets, so it doesn't reveal that a private repo exists |
| Tests | 25 `node:test` tests, synthetic data only. The CLI tests cover "replay adds no colors", "the footer is never dropped", "every element stays on one loop" and "the SVG path needs no browser". The hosted tests use a fake GitHub and cover freshness, README lookup order, error images, privacy, stale-if-error and shared fetches |

**Caveats:** Chromium is the only browser tested. Safari, Firefox, GitHub's mobile app and npmjs.com are unverified. One machine, three READMEs.

---

## 2. Competitive map (stars on 2026-09-24)

| Tool | Does | Doesn't |
|---|---|---|
| charmbracelet/vhs (20,980★) | Scripted terminal recording to GIF; excellent output | Needs installing (Go, ttyd, ffmpeg); you write the tape |
| faressoft/terminalizer (16,163★) | Records a session to GIF | Install, manual recording and editing |
| asciinema + agg (1,723★) | Cast file to GIF | Install, manual |
| conorbronsdon/demo-gif-skill (7★) | Claude Code skill that writes vhs or Playwright scripts | Needs four tools installed; costs tokens every run; maintenance mode |
| usefulagents/screencli (11★) | AI-driven browser recording | Web apps only |
| DenverCoder1/readme-typing-svg (9,361★), github-readme-stats (79,812★) | Animated SVG README widgets from a URL | Not demos, but they prove the URL-embed distribution model |

**Position:** the others record. look-what-i-can-do renders from the README, to SVG, from a URL. The moat is still thin: any agent can write a vhs tape on request. It has to win on zero setup, taste, the persona and honesty.

---

## 3. Product

### 3.1 One renderer, three lanes

| Lane | Setup | Output | Colors | Freshness | Private repos |
|---|---|---|---|---|---|
| **URL** `lookwhaticando.dev/<owner>/<repo>.svg` | Paste one line | SVG | README text, which has none. A committed capture later (§3.5) | About 6 min after a README edit (§3.4) | Refused: camo URLs are public |
| **CLI** `npx look-what-i-can-do` | None beyond Node | SVG, or GIF with `--gif` | Real, with `--live` | Whenever you run it | Fine: it's local |
| **GitHub Action** | One workflow file | SVG pushed to an `output` branch | Real, if run with `--live` in CI | On push, plus raw's 5-minute cache | Fine: their repo, their token |

The Action pushes to a separate `output` branch, the pattern the snake-game widget uses, so re-renders never land in `main`'s history. Committing the SVG directly is also fine: at about 8 KB of text it diffs well.

### 3.2 The no-cap contract (enforced by tests)

1. Replay shows README text exactly as written: no added colors, no reworded lines.
2. Live keeps the tool's real output (16, 256 and 24-bit color, bold, dim) and refuses to render a failed run.
3. Cuts are visible: `⋮` for dropped blocks, `…` for clipped lines. The last block (footers, links, calls to action) always stays.
4. The accent color only decorates the prompt and the highlight. It never recolors output.
5. The alt text is the README's own title and tagline. Under reduced motion the image shows the finished frame.

Known gap, stated rather than hidden: terminal background colors are dropped, because SVG text has no background.

### 3.3 Telling it what to animate (built)

- **Marker:** ```` ```console hero ````. GitHub ignores words after the language name, so the marker is invisible on the page. A marked block always wins.
- **Options:** an optional HTML comment above the block, such as `<!-- look-what-i-can-do highlight="unbacked" -->`. Only comments outside code blocks count, so a README that documents the comment in an example doesn't configure itself with it.
- **Fallback:** today's heuristics. The CLI says which block it used and suggests adding the marker. The URL does the same inside its error image when it finds nothing.
- **Determinism:** the same README bytes and renderer version always produce the same SVG bytes.

### 3.4 Hosted URL: the fetch-and-cache contract (built in `serve.mjs`, not deployed)

1. **Find the README:** one authenticated `GET /repos/{owner}/{repo}/readme` per new repo. It returns the README GitHub actually displays, in any case or extension. Cache the path for 24 hours and look it up again on a 404. If the API budget runs out, check raw in GitHub's order in parallel: the `.github/`, root and `docs/` folders, each with `README.md`, `readme.md` and `Readme.md`. The first check that isn't a clean 404 decides. A network error there means GitHub trouble, not "no README", and it doesn't fall through to a lower-priority README. Accept `?path=` for monorepo packages and `?ref=` for branches.
2. **Fetch:** `raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>` with `If-None-Match` set to the stored ETag. Do this at most once a minute per repo, with concurrent requests sharing one fetch. Read at most 500 KiB, where GitHub truncates.
3. **Cache and respond:** cache the render under sha256(README bytes, renderer version, options), and send that hash as our `ETag`. Always send `Content-Type: image/svg+xml; charset=utf-8` and `Cache-Control: no-cache`, GitHub's documented camo setting, so camo checks back on every view. We answer those checks with a `304` from memory.
4. **Freshness:** about 6 minutes at worst after a README edit (raw's 5-minute cache plus our 1-minute check). Raw applies the same 5-minute cache to images committed to a repo. Faster later: pin to the commit SHA (via git `ls-refs`, not the REST API) and fetch that commit's URL, which bypasses raw's cache, for about 1 minute. Instant updates would need GitHub App push webhooks.
5. **Errors never render as a broken image:** always a `200` with an error SVG in the normal frame, `no-cache`, and an `X-LWICD-Error` header for our own monitoring. Cases: bad URL, repo private or missing (same message for both), no README, a non-Markdown README, nothing to animate ("add ```` ```console hero ````"), GitHub timing out. A README over 500 KiB isn't an error: it's read up to 500 KiB, like GitHub shows it. Errors are cached for the same minute, so a broken embed on a busy page doesn't hammer GitHub. When GitHub is slow, serve the last good render marked `X-LWICD-Stale`, because camo gives up quickly. Never do that for a repo that turned private or disappeared.
6. **Private repos are refused by design.** Anyone who has a camo URL can load it, so a hosted render of a private README would leak it. The CLI and the Action cover private repos.

### 3.5 Later

- **`capture`:** `lwicd capture` commits a small asciicast of a real run, and the URL renders it. That gives full-color heroes without running anything on our servers.
- **`--check` in CI:** runs the command live and fails when the output drifts from the README's example.
- **Also:** a light-theme variant via `<picture>`, and a 1280×640 social-preview PNG.

---

## 4. Architecture

- **One scene, two writers.** The README parser, ANSI parser, block-aware fitting and timeline produce one scene.
  - **SVG (primary):** string output with zero dependencies, written in milliseconds.
  - **GIF (export):** headless Chromium seeks the same SVG frame by frame, then ffmpeg encodes it. Phase 3 replaces both with resvg-wasm and a JS GIF encoder: no browser, no native dependencies.
- **SVG details:**
  - Every element gets its own CSS keyframes on one shared loop. `animation-delay` would drift elements out of phase after the first repeat.
  - Text is `<text>`/`<tspan>` with `xml:space="preserve"`. Tabs are expanded to 8-column stops. `role="img"` plus `aria-label`, and `prefers-reduced-motion` shows the finished frame.
  - **Fonts:** the viewer's system monospace. If widths drift in practice, embed a subsetted monospace font as a data URI for about 20–40 KB; readme-typing-svg shows that loads through camo.
- **Live capture:** a pseudo-terminal via `script` on macOS and Linux (no native modules), with `COLORTERM=truecolor`. Package runners run outside the repo. Failed runs are refused. Windows is out of scope.
- **Hosted service:** a Vercel function with an in-memory and KV cache and shared (single-flight) fetches. Open source, so anyone can host their own copy.
- **Privacy:** replay reads only the README. Live runs a command you named, prints it first, and keeps the output local. The URL never runs code and never serves private repos.

---

## 5. Why it spreads

| Lever | Execution |
|---|---|
| First minute | Paste one URL and your own README plays at the top of your repo |
| Persona | 🤸 the eager kid: "look what I can do!" is the tool's first line of output and its name |
| Built-in distribution | Every embed sits at the top of someone's README. Proposed: the snippet carries an invisible `<!-- made with look-what-i-can-do -->` comment, so adoption can be counted through GitHub code search. The URL lane can also count unique repos served, and nothing about viewers |
| Launch artifact | The tool's own hero is made by the tool, and the README says so |
| Honesty as a feature | "No cap" sets it apart from demo-faking. Live mode and `--check` back that up |
| Channels | Show HN ("Your README, as an animated hero, from a URL"), r/commandline, the X dev community, Claude Code and Codex skill listings for a skill wrapper |

**Guardrail:** no unsolicited PRs adding heroes to popular repos. Only showcase repos whose maintainers opted in.

---

## 6. Roadmap (Super Logic AI, ~20 hrs/week)

| Phase | Time | Deliverable | Gate |
|---|---|---|---|
| **0: GIF CLI** | done 2026-09-24 | Replay, `--live`, fit, highlight, snippet | Superseded by Phase 1 |
| **1: SVG writer** | done 2026-09-24 | SVG primary; `--gif` exports the same SVG; 13 tests | ✅ SVG ≤ 50 KB (7.9 KB for nocap) ✅ animates in `<img>` in Chromium ⏳ checked on a private test repo: github.com in Safari, Firefox and Chrome, the GitHub mobile app, npmjs.com |
| **2: URL, marker, launch** | 2–3 wk | ✅ Marker and options comment. ✅ URL handler per §3.4 with error SVGs (local). ⏳ Deployment (Vercel + domain), the Action, npm and GitHub publish | README edits show up within 6 min; zero broken images across every error case (✅ in tests); p95 under 300 ms on a cache hit (1 ms locally) and under 1.5 s on a miss (1.1 s cold locally); ≥ 25 public repos embed it within 30 days |
| **3: Pure-JS GIF + faster freshness** | later | resvg-wasm and a JS GIF encoder (drops Chromium and ffmpeg); commit-SHA pinning (~1 min); `capture` | GIF export works with no browser; identical bytes on macOS and Linux |
| **4: GitHub App** | only if asked | Instant updates via push webhooks | Demand from Phase 2 users |

Stars are an outcome, not a gate.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Thin moat: any agent writes a vhs tape on request | Zero setup via URL, better default design, the no-cap contract |
| Used once per launch, not daily | The URL re-renders itself when the README changes; the Action and `--check` add repeat use |
| Heuristics pick the wrong block | The explicit marker; error images that teach it |
| Freshness expectations | Promise "about 6 minutes" up front, document the camo purge, and add SHA pinning when people ask |
| Camo timeouts | Cache hits answer in milliseconds; serve the last good render if GitHub is slow |
| Our uptime: READMEs depend on our server | Open source for self-hosting; the Action and committed-SVG lanes don't need us |
| GitHub throttling our raw fetches | At most one conditional fetch per repo per minute, with longer intervals for quiet repos. Per-IP limits on our side are useless, because all embed traffic arrives from camo's IPs, so limit per repo |
| Private README leak | Refused by design (§3.4.6) |
| Live mode runs commands and can reveal real data | Explicit flag, command printed first, local only, a warning every time, never on the server |
| Fonts vary by viewer | Conservative width estimate; an embedded subset font if needed |
| Untested browsers and apps | The Phase 1 gate: a private test repo before launch |

## 8. Alternatives considered

| Idea | Verdict |
|---|---|
| GIF as primary (v1) | Now an export only: 256 colors, about 1 MB, history bloat |
| A pure-JS GIF renderer first (v1 Phase 1) | Deferred to Phase 3. SVG removed the need, and even then WASM (resvg) avoids native dependencies |
| Keying the cache on commit SHA | The content-derived ETag already invalidates cleanly when the README changes, without extra renders for commits that don't touch it. The SHA is only for freshness (Phase 3) |
| Hosted private repos via a token | Rejected: camo makes the image public |
| Agent blast-radius audit ("babyproof") | Parked. It used the title ironically, and static MCP scanning is a crowded space |
| MP4 | GitHub only plays video uploaded as an attachment, not video committed to a repo |

## 9. Relationship to Supra, nocap and rentroll, and decisions needed

It's a spin-off of the Supra ideation, like nocap and rentroll, and the only one that isn't agent-specific. It's the launch tool for both, and it shares nocap's rule: show real evidence, never a flattering fake.

**Decisions for you:**
1. **Private test repo:** OK to create `SuperLogicAI/lwicd-test` to close the Phase 1 gate (browsers, mobile app, npm)?
2. **Name and bins:** `look-what-i-can-do`, with `lwicd` as a short alias. The npm name was free on 2026-09-24.
3. **License:** MIT, like agent-nocap (recommended).
4. **Deploying the URL lane:** a go-ahead to deploy `serve.mjs` (Vercel is the default), a domain (`lookwhaticando.dev` or similar, not yet checked), and a cost ceiling. Optional `GITHUB_TOKEN`: a fine-grained token with public-repository read access only. It just raises the lookup limit, since README bytes never use it.
5. **Credit in the snippet:** an invisible HTML comment (recommended), a visible credit, or none.
6. **Publishing the CLI:** before Phase 2 or with it. For an SVG-only first release, playwright-core should become optional so `npx` stays light.
