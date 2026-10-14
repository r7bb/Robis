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

Used by the API to decode, resize and re-encode profile pictures, which is
also what strips their metadata. `sharp` 0.34.5 is licensed under the Apache
License 2.0. It loads a prebuilt `libvips` (`@img/sharp-libvips-*`), licensed
under the GNU LGPL 3.0 or later, as a separate shared library, together with
the libraries libvips bundles under their own licences (listed in the
package). Its source is available from <https://github.com/libvips/libvips>.

Flagged for review: LGPL code is used only server-side and dynamically linked,
and is not modified here. Whether that is enough for a given distribution of
Robis is a question for whoever ships it, not something this file decides.

## Mail

`nodemailer` 10.0.12 sends mail over SMTP from the worker, and `smtp-server`
3.19.15 runs the local development inbox and the mail tests. Both are
licensed MIT-0, which asks for no attribution; they are recorded here so the
licence of everything added is written down. `smtp-server` brings
`punycode.js` 2.3.1 and `ipv6-normalize` 1.0.1, both MIT. The type packages
`@types/nodemailer` 8.0.2 and `@types/smtp-server` 3.5.13 are MIT and are used
only at build time.

## Used only in CI

**Adobe S3Mock** (`adobe/s3mock:5.2.3`), Apache License 2.0. A test double
for S3 that runs as a service container so the storage driver's contract
tests run against a real S3-compatible server. It is never shipped with
Robis. It stands in for MinIO, whose image is no longer published on Docker
Hub.

