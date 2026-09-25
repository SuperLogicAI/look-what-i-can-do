<p align="center">
  <img src="docs/hero.svg" width="800" alt="look-what-i-can-do 🤸: Your README, as an animated hero. One command.">
</p>

# look-what-i-can-do 🤸

**Your README, as an animated hero. One command.**

It reads your README's title, tagline, run command and example output, types the command, plays the output, and writes an animated SVG you paste at the top: a few KB, full color, sharp at any size. `--gif` exports the same hero as a GIF for places that don't take SVG, like X, LinkedIn and Product Hunt. The image above is this README, made by the command below. Where it's headed, a hosted URL with zero setup, is in [the proposal](PROPOSAL.md).

```console
$ node lwicd.mjs -o docs/hero.svg --highlight rendered
🤸 look what I can do!

  read      README.md: look-what-i-can-do 🤸
  replayed  11 lines of example output, as written (READMEs have no colors; --live runs it)
  rendered  docs/hero.svg · 1280×640 · 8.4 s loop · 9.5 KB · in 0.0 s

Paste at the top of your README:

<p align="center">
  <img src="docs/hero.svg" width="800" alt="look-what-i-can-do 🤸: Your README, as an animated hero. One command.">
</p>
```

## Run it

```sh
node lwicd.mjs path/to/README.md           # animated SVG: needs Node and nothing else
node lwicd.mjs path/to/README.md --live    # run the command in a terminal: real output, real colors
node lwicd.mjs path/to/README.md --gif     # GIF export: npm install first; needs Chrome or Chromium, and ffmpeg
npm test                                   # fixture tests, synthetic data only
```

| Option | What it does |
|---|---|
| `-o, --out <file>` | Where to write it (default `look-what-i-can-do.svg`, or `.gif` with `--gif`) |
| `--gif` | Export a GIF of the same hero instead |
| `--live` | Run the command in a pseudo-terminal and show its real output and colors |
| `--command <cmd>` | The command to show, and with `--live` to run (default: the README's) |
| `--highlight <text>` | Sweep a highlight over the first output line that contains this text |

## Why SVG

The same agent-nocap hero is 7.9 KB as SVG and about 950 KB as GIF. SVG keeps full color where GIF has 256, stays sharp on every screen, and barely touches your Git history when you re-render it. GitHub shows animated SVG through `<img>`, and it loops on its own. Viewers who turn on reduced motion get the finished frame.

## No cap

The image never shows output your tool can't produce.

- **Replay** (the default) shows your README's example output exactly as written. README code blocks carry no colors, so none are added. It runs nothing from your repo.
- **Live** runs the command in a pseudo-terminal, so tools that only color a real terminal keep their colors. It refuses to render when the command fails. Package runners (`npx`, `bunx`, `uvx`) run outside your repo. Live output is your real output: review it before you publish.
- Too tall for the frame: whole blocks from the top plus the last block (footers, links) stay, and the cut is marked `⋮`. Too wide: the font shrinks, then the line is cut and marked `…`.
- The accent color touches the prompt and the highlight, never your output.

[examples/agent-nocap.svg](examples/agent-nocap.svg) is a replay of [agent-nocap](https://github.com/SuperLogicAI/agent-nocap)'s README.

## How it reads a README

- **Title:** the first `#` heading. **Tagline:** the first paragraph after it that isn't HTML, a badge or a table, cut to its first sentence when it runs past 100 characters.
- **Command and output:** a `console` block's `$ command` and the lines after it. Otherwise the first run command (`npx`, `npm`, `pip`, `brew`, `cargo`, `go`, `docker`, `node`, `python`, …) in a shell block, with the first untagged or `text` block as its output.

## Known limits

The SVG uses the viewer's monospace font, so line widths differ slightly between systems. Terminal background colors, like badge-style labels, are dropped rather than faked. `--gif` needs headless Chromium (playwright-core's, or Google Chrome) and ffmpeg; a pure-JS export is planned. `--live` needs `script` (macOS, Linux) and handles colors, carriage returns and one-line spinners, not full-screen or multi-line progress displays. A README without example output replays the command alone: add an example, or use `--live`. Tested in Chromium so far; Safari, Firefox and GitHub's mobile app are next.

Built by [Super Logic AI](https://superlogicai.com).
