# look_what_i_can_do

`look-what-i-can-do` turns a README into an animated hero: title, tagline, the run command typed out, then its output, written as an animated SVG (GIF export optional). A Super Logic AI project; the plan is in [PROPOSAL.md](PROPOSAL.md) (v2: SVG-first, zero setup from a URL). Started 2026-09-24 as a spin-off of the Supra ideation, like nocap and rent_roll.

## Commands

- `npm test`: fixture tests (`node:test`, synthetic data only). Run before claiming done. No linter configured.
- `node lwicd.mjs [README.md] [-o file.svg] [--gif] [--live] [--command <cmd>] [--highlight <text>]`
- The SVG path needs only Node. `--gif` needs Chromium (playwright-core's headless shell, or Google Chrome) and `ffmpeg` on PATH.
- Re-render this repo's hero after README changes: `node lwicd.mjs -o docs/hero.svg --highlight rendered`. Paste its real output into the README's console block first, then render again, so the hero replays a real run.

## Rules

- No cap: an image never shows output the tool can't produce. Replay renders README text as written, with no added colors. Live keeps real ANSI output and refuses to render a failed run. Cuts show `⋮` (dropped blocks) or `…` (clipped lines), and the last block (the footer) stays. The tests enforce this; extend them whenever rendering changes.
- The accent color touches the prompt and the highlight only, never output.
- Every SVG element gets its own keyframes on one shared loop. Don't use `animation-delay`: it drifts out of phase on repeat.
- Replay runs nothing from the target repo. Only `--live` runs a command, and it prints the command first.
- Live output can hold real data (rentroll prints real spend, nocap prints real counts). Never commit a live render of the founder's tools without asking. Examples in this repo are replays of public README text.
- One file, `lwicd.mjs`, Node ≥ 20. playwright-core (pinned) is used only by `--gif`.
- The hosted URL must never serve private repos: camo URLs are public.
- Mark deliberate shortcuts with `ponytail:` comments that name the ceiling and the upgrade path.
- `package.json` stays `private: true`. Publishing to npm or GitHub is outward-facing: ask first.

## Status (2026-09-24)

- Phase 1 built: animated SVG writer (primary), `--gif` export of the same SVG, replay, `--live`, fit, highlight, snippet. `examples/agent-nocap.svg` is a replay of agent-nocap's README; `docs/hero.svg` is this README.
- Phase 1 gate still open: verify on a private GitHub test repo (Safari, Firefox, GitHub mobile, npmjs.com). Creating it needs the founder's OK.
- Next (Phase 2): the ```` ```console hero ```` marker, the hosted URL per PROPOSAL §3.4, error SVGs, the GitHub Action.
