---
name: look-what-i-can-do
description: Build or refresh a repo's animated README hero, the terminal demo at the top of a README that types a command and plays its real output, with the look-what-i-can-do CLI (lwicd), as an animated SVG or a GIF for social posts. Use this whenever someone wants a demo GIF or animated SVG for their README, a hero image for a GitHub repo or launch, to show off what their CLI does at the top of the README, or to fix a stale or fake-looking README demo, or when they mention look-what-i-can-do, lwicd or lookwhaticando.dev, even if they only say "make my README pop" or "add a demo to the README".
---

# look-what-i-can-do

You're shaping the hero at the top of a README: an animated terminal that types the repo's command and plays its output. The CLI does the rendering. Your job is the judgment it can't make (which command tells the story, which line is the headline) and getting real output into the README.

One rule sits under everything, and the tool calls it "no cap": the image never shows output the tool can't produce. A hero with typed-in or tidied-up numbers is a fake demo, and visitors can't tell until it burns them. That's why output only ever enters the README through `capture`, which runs the command and copies what it printed, and never through your own typing.

## Find the CLI

- Usually: `npx look-what-i-can-do`, which is on npm.
- If you're working on look-what-i-can-do itself, or can't reach npm, use `lwicd.mjs` in the repo this skill lives in, two levels above this skill's folder. Resolve symlinks first, because the skill may be linked into `~/.claude/skills`:

  ```sh
  LWICD="$(cd "$(dirname "$(realpath "<this skill's base directory>/SKILL.md")")/../.." && pwd)/lwicd.mjs"
  node "$LWICD" --help
  ```

Below, `lwicd` means whichever of these works.

## 1. Read the README and the tool

- Read the whole README. Note the install and run commands, any example output, and whether it already has a block fenced ```` ```console hero ```` or a `<!-- look-what-i-can-do ... -->` comment. Existing marks are the author's choices: keep them unless you're asked to change them.
- Check whether the repo is public (`gh repo view --json visibility`, or the remote URL). That decides the embed at the end.

## 2. Pick the story

This is the part that needs judgment.

- **The command:** the one a first-time visitor would run first. Usually that's the zero-install line (`npx tool`, `uvx tool`, `docker run …`). It should finish in seconds, change nothing, and show the payoff in about 20 lines or fewer.
- **The headline:** the one output line that proves the tool is worth it. Prefer the insight over the vanity metric. For agent-nocap, `unbacked 34 (15%)`, claims no check backed, says more than `backed 179 (78%)`, because the tool exists to catch what isn't backed.
- When two commands or headlines are plausible, show the user both and let them choose. It's their README and their positioning.

Skip commands that need credentials, write anything, take minutes, or print secrets or personal paths.

## 3. Mark the block

Put the hero block where the demo belongs: usually right under the tagline, or reuse the existing example block. The marker goes after the language on the fence. GitHub ignores it, so readers never see it:

````markdown
```console hero
$ npx your-tool
```
````

Set the highlight in a comment just above the block, which GitHub doesn't show either. Use text that appears in the headline line:

```html
<!-- look-what-i-can-do highlight="unbacked" -->
```

The choices go in the README rather than in CLI flags because there they persist, show up in review, and are the only thing the hosted URL can read.

## 4. Capture real output

```sh
lwicd capture README.md
```

It runs the block's `$` command in a real terminal and writes what it printed into the block, with colors dropped because README code blocks can't hold them. It prints the captured lines. Show them to the user and get an OK before anything is committed: this is their real data, including counts, paths and sometimes spend.

- **Too long, or the wrong shape?** Change the command (a flag, a smaller example) and capture again. Don't trim or retype lines: once output is hand-edited, the hero stops being evidence.
- **The command fails?** `capture` leaves the README untouched and shows the last lines. Fix the cause or choose another command.
- **Can't run it here** (it needs a service, credentials or a long job)? Ask the user to run it and paste the real output, or keep an existing example you know is real. Don't invent it.

## 5. Render and check

```sh
lwicd README.md -o docs/hero.svg          # replays the README: what the hosted URL will show
lwicd README.md -o docs/hero.svg --live   # runs the command: real colors, for a committed file
lwicd README.md --gif -o hero.gif         # only for X, LinkedIn or Product Hunt (needs Chromium and ffmpeg)
```

Read the summary it prints. `block` should say `the one marked hero`. If it warns `highlight: no shown line contains …`, fix the highlight text. Then look at the result (`open -a Safari docs/hero.svg`) and check that it reads at a glance: the command, the payoff, the headline.

## 6. Hand it back

- **Public repo:** use the hosted URL, which means nothing else to commit:

  ```html
  <p align="center"><img src="https://lookwhaticando.dev/<owner>/<repo>.svg" width="800" alt="<title>: <tagline>"></p>
  ```

  It re-renders itself within about 7 minutes of a README edit. It replays README text, so the hosted hero has no colors. If colors matter, commit an SVG made with `--live` instead.
- **Private repo:** commit the rendered SVG and use the snippet the CLI printed. Don't point a private repo at the hosted URL: it refuses private repos by design, because image URLs are public.

End with a short summary: the command, the headline, what changed in the README, and what the user should review. Don't commit or push unless they ask.
