// main.ts — le programme que le harnais lance : `node /bot/main.ts`.
// Il lit tous les cas de /input/cases.json, répond à chacun avec run() de solve.js, et écrit
// /output/answers.json (un tableau des réponses, dans l'ordre des cas).
// Hors conteneur, MAKEFUN_INPUT_DIR et MAKEFUN_OUTPUT_DIR remplacent /input et /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Avant l'import de solve.js, pour que tout son travail se fasse sous ces réglages (les règles
// autorisent l'entrée à régler les drapeaux de V8 comme le fait la référence).
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--max-semi-space-size=64');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
