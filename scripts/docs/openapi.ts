/**
 * `bun run openapi`: write docs/openapi.json from the route contracts
 * (stage 2, item 20), and docs/API.md, the reference people read, from the
 * same contracts (C7). Never edit either by hand; `tests/http-contracts`
 * fails when they are not what the contracts say.
 */
import { apiReferenceMarkdown, openApiDocument } from '@robis/shared';

const OUT = new URL('../../docs/openapi.json', import.meta.url);
await Bun.write(OUT, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
console.log(`Wrote ${OUT.pathname}`);
const PAGE = new URL('../../docs/API.md', import.meta.url);
await Bun.write(PAGE, apiReferenceMarkdown());
console.log(`Wrote ${PAGE.pathname}`);
