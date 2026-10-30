/**
 * `bun run openapi`: write docs/openapi.json from the route contracts
 * (stage 2, item 20). Never edit that file by hand; `tests/http-contracts`
 * fails when it is not what the contracts say.
 */
import { openApiDocument } from '@robis/shared';

const OUT = new URL('../../docs/openapi.json', import.meta.url);
await Bun.write(OUT, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
console.log(`Wrote ${OUT.pathname}`);
