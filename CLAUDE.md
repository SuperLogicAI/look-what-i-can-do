# look_what_i_can_do

`look-what-i-can-do` turns a README into an animated hero: title, tagline, the run command typed out, then its output, written as an animated SVG (GIF export optional). A Super Logic AI project; the plan is in [PROPOSAL.md](PROPOSAL.md) (v2: SVG-first, zero setup from a URL). Started 2026-09-24 as a spin-off of the Supra ideation, like nocap and rent_roll.

## Commands

- `npm test`: `lwicd.test.mjs` (CLI and renderer) and `serve.test.mjs` (hosted URL against a fake GitHub). `node:test`, synthetic data only, no network. Run before claiming done. No linter configured.
- `node lwicd.mjs [README.md] [-o file.svg] [--gif] [--live] [--command <cmd>] [--highlight <text>]`
- `node lwicd.mjs capture [README.md]`: runs the ```` ```console hero ```` block's `$` command in a pseudo-terminal and writes its real output (colors dropped) into that block. A failed run leaves the README untouched.
- `node lwicd.mjs serve [--port 8787]`: the hosted URL in plain Node. `npx wrangler dev`: the same in the Workers runtime. Both talk to real GitHub, with a 60/hour API limit without `GITHUB_TOKEN`.
- `npx wrangler deploy`: deploys the Worker to lookwhaticando.dev (`wrangler.jsonc`). It is production: ask first. `npx wrangler tail look-what-i-can-do --format json`: the live request log (useful for checking what GitHub's camo actually sends).
- The SVG path needs only Node. `--gif` needs Chromium (playwright-core's headless shell, or Google Chrome) and `ffmpeg` on PATH.
- Re-render this repo's hero after README changes: `node lwicd.mjs capture`, which fills the README's ```` ```console hero ```` block with a real run, then `node lwicd.mjs -o docs/hero.svg`.

## Rules

- No cap: an image never shows output the tool can't produce. Replay renders README text as written, with no added colors. Live keeps real ANSI output and refuses to render a failed run. Cuts show `⋮` (dropped blocks) or `…` (clipped lines), and the last block (the footer) stays. The tests enforce this; extend them whenever rendering changes.
- The accent color touches the prompt and the highlight only, never output.
- Every SVG element gets its own keyframes on one shared loop. Don't use `animation-delay`: it drifts out of phase on repeat.
- Replay runs nothing from the target repo. Only `--live` runs a command, and it prints the command first. The hosted URL never runs anything.
- Hosted: README bytes only ever come from unauthenticated raw.githubusercontent.com fetches, so private repos can't be served even if a token can see them. Never add a code path that reads README content with a token. Errors are 200 SVGs (camo turns other statuses into broken images).
- Live output can hold real data (rentroll prints real spend, nocap prints real counts). Never commit a live render of the founder's tools without asking. Examples in this repo are replays of public README text.
- Files: `render.mjs` (the pure renderer), `serve.mjs` (the hosted handler and the Cloudflare Worker entry), `lwicd.mjs` (the Node CLI: files, `--gif`, `--live`, `serve`). `render.mjs` and `serve.mjs` must never import from Node; a test enforces it, because the Worker can't load them otherwise. Node ≥ 20. playwright-core (pinned) is used only by `--gif`.
- Mark deliberate shortcuts with `ponytail:` comments that name the ceiling and the upgrade path.
- `package.json` stays `private: true`. Publishing to npm or GitHub, and deploying `serve.mjs`, are outward-facing: ask first.

## Status (2026-09-24)

- Built: animated SVG writer (primary), `--gif` export of the same SVG, replay, `--live`, fit, highlight, the ```` ```console hero ```` marker plus options comment, and the hosted URL handler (`serve.mjs`, PROPOSAL §3.4), tested locally against real GitHub.
- On hold (founder said wait): the private GitHub test repo for Safari, Firefox, GitHub mobile and npmjs.com.
- Hosting: Cloudflare Workers on lookwhaticando.dev, live since 2026-09-24 (the founder bought the domain that day; its DNS is on Cloudflare). Chosen over Vercel because Hobby is non-commercial and caps usage, and Workers is about 10× cheaper at scale (PROPOSAL §4). Move to Workers Paid ($5/mo) before launch: Free fails requests past 100k a day, and a failed request is a broken image.
- Repo: github.com/SuperLogicAI/look-what-i-can-do (private for now). Not built: the GitHub Action.
- Skill: `skills/look-what-i-can-do/SKILL.md`. An agent picks the story, marks the block, fills it with `capture`, renders and hands back. Walked through end to end on a synthetic README, but not formally evaluated yet: run `claude plugin eval` or the skill-creator loop before anyone else relies on it. Installing it into `~/.claude/skills` changes the founder's global setup: ask first. Rule for edits: output only enters a README through `capture` or the user pasting a real run, never typed.
