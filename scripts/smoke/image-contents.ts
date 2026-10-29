/**
 * What each backend image carries: `bun run smoke:images`, after
 * `docker compose build` (stage 2, item 17).
 *
 * Each service installs only its own dependencies, so the gateway and the
 * worker images must hold no sharp (a native image library, and the API's
 * alone) and no Fastify (the API's web server). The API image must hold
 * both, which is the proof the search would see them if they were there.
 * The web image holds no sharp either (stage 2, item 19): it serves images
 * as they are, prerendered at build.
 * Exits non-zero, naming the image, on the first that is wrong.
 *
 * Imports nothing from the repository, so CI can run it without installing.
 */

const TAG = process.env.SMOKE_IMAGE_TAG ?? 'stack';
const PACKAGES = ['sharp', 'fastify'] as const;

/** Every installed copy of the packages in an image, as paths. */
async function installed(image: string): Promise<string[]> {
  const names = PACKAGES.flatMap((name, i) => [...(i > 0 ? ['-o'] : []), '-name', name]);
  const run = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '--entrypoint',
      'find',
      image,
      '/app',
      '-path',
      '*node_modules*',
      '(',
      ...names,
      ')',
      '-prune',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  if (code !== 0) throw new Error(`could not look inside ${image}: ${err.trim()}`);
  return out.split('\n').filter(Boolean);
}

function holds(paths: readonly string[], name: string): boolean {
  return paths.some((path) => path.endsWith(`/${name}`));
}

let failed = false;
function report(ok: boolean, line: string) {
  process.stdout.write(`  ${ok ? 'ok ' : 'not ok'}  ${line}\n`);
  if (!ok) failed = true;
}

const api = await installed(`robis-api:${TAG}`);
for (const name of PACKAGES) report(holds(api, name), `the API image holds ${name}`);

for (const service of ['realtime', 'worker']) {
  const paths = await installed(`robis-${service}:${TAG}`);
  for (const name of PACKAGES) {
    const found = paths.filter((path) => path.endsWith(`/${name}`));
    report(
      found.length === 0,
      `the ${service} image holds no ${name}${found.length ? ` (found ${found.join(', ')})` : ''}`,
    );
  }
}

const web = await installed(`robis-web:${TAG}`);
const webSharp = web.filter((path) => path.endsWith('/sharp'));
report(
  webSharp.length === 0,
  `the web image holds no sharp${webSharp.length ? ` (found ${webSharp.join(', ')})` : ''}`,
);

if (failed) {
  process.stdout.write('Image contents check failed.\n');
  process.exit(1);
}
process.stdout.write('Image contents check passed.\n');
