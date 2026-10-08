import type { NextConfig } from 'next';

const config: NextConfig = {
  /*
   * Dev and production builds write to different directories.
   *
   * They shared `.next` by default, so running `bun --filter '@robis/web'
   * build` while the dev server was up replaced the chunks that server had
   * already loaded. The next request died with `Cannot find module
   * './539.js'` from `webpack-runtime.js`, which reads like a corrupted
   * install and is really just two processes writing to one directory.
   *
   * `bun run dev:web` sets `NEXT_DIST_DIR=.next-dev`, so a build can run at
   * any time without touching what dev is serving.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  // The workspace packages ship TypeScript source rather than build output, so
  // Next has to compile them alongside the app.
  transpilePackages: ['@robis/shared'],
  /*
   * The dev-mode build indicator is a floating badge in the bottom-left
   * corner. It is useful while developing and it also lands in the middle of
   * every screenshot the capture script takes against the dev server, where
   * it reads as a rendering bug rather than as tooling.
   */
  devIndicators: false,
};

export default config;
