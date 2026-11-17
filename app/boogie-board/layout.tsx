import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Boogie Board',
  description: 'Steer through the hole in every wave.',
};

export default function BoogieBoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
