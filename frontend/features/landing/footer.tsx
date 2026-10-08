import Link from 'next/link';
import { Logo } from '../../components/brand/logo.tsx';

/**
 * A grouped footer, shared by the public pages.
 *
 * Both pages previously ended in a single thin row of three links, which
 * is where a site stops rather than where it ends. Grouping gives the
 * reader somewhere to go after the last section, and gives the honest
 * caveats a permanent home rather than burying them mid-page.
 *
 * Every external link carries `rel="noopener noreferrer"`. Without
 * `noopener` the opened page gets a handle on this one through
 * `window.opener` and can navigate it somewhere else.
 */

const REPO = 'https://github.com/r7bb/Robis';

type Entry = { label: string; href: string; external?: boolean };

const GROUPS: { title: string; links: Entry[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  {
    title: 'Source',
    links: [
      { label: 'Repository', href: REPO, external: true },
      {
        label: 'Architecture notes',
        href: `${REPO}/blob/main/docs/ARCHITECTURE.md`,
        external: true,
      },
      { label: 'Roadmap', href: `${REPO}/blob/main/docs/ROADMAP.md`, external: true },
    ],
  },
  {
    title: 'Built with',
    links: [
      { label: 'Bun', href: 'https://bun.sh', external: true },
      { label: 'Postgres', href: 'https://www.postgresql.org', external: true },
      { label: 'Yjs', href: 'https://yjs.dev', external: true },
    ],
  },
];

const LINK =
  'text-sm text-faint transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content';

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-[#08090c]">
      <div className="mx-auto max-w-6xl px-6 py-[clamp(3rem,7vh,5rem)]">
        <div className="grid gap-10 text-left sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo size={28} />
            <p className="mt-4 max-w-[28ch] text-sm leading-relaxed text-faint">
              A collaborative workspace that keeps working when the network does not.
            </p>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {group.title}
              </h2>

              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className={LINK}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/*
          The caveat lives here on purpose. It is true on every page, and a
          reader who has scrolled this far deserves to meet it before they
          form an impression the project cannot support.
        */}
        <p className="mt-12 border-t border-line pt-6 text-xs leading-relaxed text-faint">
          Robis is a portfolio project. It runs locally and is tested; it has not been deployed, and
          nothing here is a security or compliance claim. Logos belong to their respective owners
          and are shown to say what Robis is built with.
        </p>
      </div>
    </footer>
  );
}
