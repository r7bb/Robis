# Third-party notices

Licences for assets that ship to visitors and carry an attribution
requirement. npm dependencies carry their own licence files in their
packages and are not repeated here.

## Geist Sans

Used for the landing page, through the `geist` npm package (1.3.1).

Copyright (c) 2023 Vercel, in collaboration with basement.studio

Licensed under the SIL Open Font License, Version 1.1. The full licence text
is in `node_modules/geist/LICENSE.TXT` and at <https://openfontlicense.org>.

## sharp and libvips

Used by the API to decode, resize and re-encode every uploaded image, which
is also what strips their metadata, and to draw a meme caption across a
photo posted to the feed (Phase 2c). The API alone holds it. `sharp` 0.35.5 is licensed under the Apache
License 2.0. It loads a prebuilt `libvips` (`@img/sharp-libvips-*`), licensed
under the GNU LGPL 3.0 or later, as a separate shared library, together with
the libraries libvips bundles under their own licences (listed in the
package). Its source is available from <https://github.com/libvips/libvips>.

Flagged for review: LGPL code is used only server-side and dynamically linked,
and is not modified here. Whether that is enough for a given distribution of
Robis is a question for whoever ships it, not something this file decides.

## MCP server

The agents' MCP server (`backend/mcp`) is built on the official Model Context
Protocol TypeScript SDK, `@modelcontextprotocol/sdk` 1.32.1, pinned exactly,
licensed under the MIT License. It brings its own dependencies (Express, Hono,
CORS, Ajv, jose and others), which are installed only in the `mcp` image. As
counted in that image on 2026-11-17, its 92 packages are licensed MIT (82),
ISC (7), BSD-3-Clause (2) and BSD-2-Clause (1); none is copyleft.

## Language-model summaries (optional)

The triage agent's optional one-line summary uses Anthropic's official
TypeScript SDK, `@anthropic-ai/sdk` 1.4.0, pinned exactly, licensed under
the Apache License 2.0, installed in the worker only. It brings
`@opentelemetry/api` (Apache-2.0), `json-schema-to-ts`, `standardwebhooks`,
`ts-algebra`, `@stablelib/base64` and `@babel/runtime` (all MIT), and
`fast-sha256`, which is released under the Unlicense (a dedication to the
public domain), flagged here because it is not a conventional licence.

## Pictures from public image libraries (Phase 2c)

The pictures agent, when a workspace chooses one, posts pictures from NASA's
image library (images.nasa.gov), Wikimedia Commons' picture of the day
(through api.wikimedia.org) and Openverse (api.openverse.org). It uses a
picture only under a licence that allows reuse with credit: public domain,
CC0, CC BY or CC BY-SA, checked in `backend/worker/src/pictures/sources.ts`.
Each post carries the picture's title, creator, licence and a link to its
source. A meme (a caption drawn on the picture) is made only from a public
domain or CC0 picture, so no licence's terms for changed work arise, and
its credit says the caption was added. NASA's material is generally not
subject to copyright, though NASA asks that it not be used to imply
endorsement; work in its library by others is skipped.

Flagged for review: licence data comes from each library and is relied on
as given; whether a picture is fit for a given workplace, and any rights
beyond copyright (people shown in a photo, trademarks), are for whoever
runs Robis to judge. Robis claims no licence of its own over these pictures.

## Board ordering

Card positions use `fractional-indexing` 4.0.0, pinned exactly, released
under CC0-1.0 (a dedication to the public domain), with no dependencies.

## Two-factor QR code

The account page draws the QR code an authenticator app scans with
`qrcode-generator` 2.0.4 by Kazuhiko Arase, pinned exactly, released under the
MIT licence, with no dependencies. The authenticator codes themselves are
computed by Robis (RFC 6238, `backend/auth/src/totp.ts`), with no library.

## Passkeys

Passkeys are checked on the server with `@simplewebauthn/server` 14.0.3 and
started in the browser with `@simplewebauthn/browser` 14.0.0, both by Matthew
Miller, pinned exactly, released under the MIT licence. The server package
brings in, all at the versions in `bun.lock`:

- MIT: `@peculiar/x509`, `@peculiar/asn1-*` and `@peculiar/utils`,
  `@hexagon/base64`, `@levischuck/tiny-cbor`, `pvtsutils`, `pvutils` and
  `tsyringe`.
- Apache-2.0: `reflect-metadata` 0.2.2 (Microsoft). Its licence and notice
  ask to be kept with any copy that is passed on.
- BSD-3-Clause: `asn1js` 3.1.0 (Peculiar Ventures, GMO GlobalSign). Its
  copyright notice, conditions and disclaimer ask to be kept with any copy
  that is passed on.
- 0BSD: `tslib` 1.14.1 and 2.8.1 (Microsoft), which asks for nothing.

## Tracing

Traces (A5) use OpenTelemetry for JavaScript, by the OpenTelemetry authors,
released under the Apache-2.0 licence and pinned exactly:
`@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/context-async-hooks`, `@opentelemetry/core` and
`@opentelemetry/resources` 2.12.0, and `@opentelemetry/exporter-trace-otlp-http`
0.223.0. They bring in only OpenTelemetry's own packages, all Apache-2.0, at
the versions in `bun.lock`: `sdk-trace`, `sdk-logs`, `sdk-metrics`,
`api-logs`, `otlp-exporter-base`, `otlp-transformer` and
`semantic-conventions`. Apache-2.0 asks for its licence and any NOTICE file
to be kept with a copy that is passed on.

## Mail

`nodemailer` 10.0.12 sends mail over SMTP from the worker, and `smtp-server`
3.19.15 runs the local development inbox and the mail tests. Both are
licensed MIT-0, which asks for no attribution; they are recorded here so the
licence of everything added is written down. `smtp-server` brings
`punycode.js` 2.3.1 and `ipv6-normalize` 1.0.1, both MIT. The type packages
`@types/nodemailer` 8.0.2 and `@types/smtp-server` 3.5.13 are MIT and are used
only at build time.

## Python dependencies of the ML service

Locked with hashes in `robis-ml/requirements.lock` and installed into the ML
image. Most are MIT, BSD or Apache 2.0. `psycopg` and `psycopg-binary`
3.3.6 are licensed under the GNU LGPL 3.0, and `psycopg-binary` bundles
`libpq` (the PostgreSQL License) and the libraries it links. Flagged for
review, as with libvips above: the code is unmodified and loaded as a
library, and whether that suffices for a given distribution is for whoever
ships it to decide. For traces (A5) the service adds `opentelemetry-sdk`
1.45.1 and `opentelemetry-semantic-conventions` 0.66b1, by the
OpenTelemetry authors, Apache-2.0; `opentelemetry-api` was already there
through FastAPI. Its spans are sent by a small exporter of its own
(`robis_ml/telemetry.py`), not the SDK's OTLP exporters, which would add
protobuf and gRPC.

## Container base images

The images in `deploy/docker` start from `oven/bun` 1.4.2 (Bun, MIT, on
Debian) and `python` 3.11.16 (the Python Software Foundation License, on
Debian). Debian's packages carry their own licences, listed in each image
under `/usr/share/doc`. The stack also runs the official `postgres` 18.6
image (the PostgreSQL License).

## Used only in CI

**Caddy** (`caddy:2.11.7-alpine`, pinned by digest), Apache License 2.0. The
edge proxy in the container stack: it serves the web app, the API at `/api`
and the gateway at `/ws` from one origin. Used unmodified, as its image.

**Adobe S3Mock** (`adobe/s3mock:5.2.3`), Apache License 2.0. A test double
for S3 that runs as a service container so the storage driver's contract
tests run against a real S3-compatible server. It is never shipped with
Robis. It stands in for MinIO, whose image is no longer published on Docker
Hub.

**Knip** (`knip@6.41.0`, pinned), ISC License. Finds unused files, exports
and dependencies; run by `bun run knip` and in the `test` job. A development
tool only: it is never shipped with Robis.

**Trivy** (`aquasec/trivy:0.74.0`, pinned by digest), Apache License 2.0.
Scans every built image for known vulnerabilities in the `containers` job.
It is never shipped with Robis.

