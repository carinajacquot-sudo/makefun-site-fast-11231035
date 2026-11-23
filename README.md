# carinajacquot-sudo/makefun-site-fast-11231035

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/carinajacquot-sudo/makefun-site-fast-11231035/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/carinajacquot-sudo/makefun-site-fast-11231035/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own `makefun-site` 1.0.0: `solve.js` answers exactly as the
reference program does, byte for byte, in about half the CPU time. The Markdown subset, the
template dialect, the front matter, the slug rule and the build report are the reference's own;
this entry only changes how they are executed — the HTML escape returns the text untouched when
there is nothing to escape, the Markdown is read by position instead of being split into lines,
and each template is translated once into a JavaScript function on its own scope.

## Run it

```sh
node main.ts
```

It reads every case from `/input/cases.json` (or `MAKEFUN_INPUT_DIR`), answers each one with
`run(input)` from `solve.js`, and writes `/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
