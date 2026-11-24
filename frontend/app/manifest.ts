import type { MetadataRoute } from 'next';

/**
 * The web app manifest (C8): what a phone needs to install Robis to its
 * home screen and open it as an app of its own, without the browser's
 * bars. Served by Next at /manifest.webmanifest. The colours are the
 * default theme's, as the first paint is; a workspace's own theme applies
 * once it loads.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Robis',
    short_name: 'Robis',
    description: 'Issues, documents, chat and meetings for a team, working offline too.',
    start_url: '/workspaces',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0e1014',
    theme_color: '#0e1014',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Share a photo, a link or some words to Robis from another app (C8): the
    // service worker keeps them and the share page makes an issue of them.
    share_target: {
      action: '/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'files', accept: ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] }],
      },
    },
  };
}
