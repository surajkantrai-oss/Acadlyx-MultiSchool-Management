import { APP_NAME } from '@acadlyx/constants';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: `${APP_NAME} Platform Admin`,
  description: 'Internal Acadlyx portal for managing tenants/schools.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
