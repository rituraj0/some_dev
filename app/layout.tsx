import type { Metadata } from 'next';
import metrics from './data/metrics.json';
import './globals.css';

// Derived from the data so the description can never drift out of date.
export const metadata: Metadata = {
  title: 'Who are PostHog\u2019s most impactful engineers?',
  description:
    `A ${metrics.meta.windowDays}-day impact analysis of the PostHog/posthog repository: ` +
    `${metrics.stats.mergedPrs.toLocaleString('en-US')} merged PRs scored on shipped weight, ` +
    'review leverage, trust centrality, domain ownership and unblocking speed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
