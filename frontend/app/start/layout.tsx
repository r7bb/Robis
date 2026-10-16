import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Get started · Robis',
  description: 'A short look at what Robis does and what signing up asks for.',
};

export default function StartLayout({ children }: { children: ReactNode }) {
  return children;
}
