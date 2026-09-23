import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'Kallpa CRM', template: '%s · Kallpa CRM' },
  description: 'CRM multicanal: WhatsApp, Messenger y TikTok en una sola bandeja',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
