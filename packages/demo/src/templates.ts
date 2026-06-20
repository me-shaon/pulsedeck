/**
 * Realistic report templates for the PulseDeck demo agent.
 *
 * These are pure, plain-object builders that emit the on-the-wire report shape
 * exactly as a third-party agent would (BLOCK_SCHEMA.md + the canonical report
 * schema). NOTHING here imports `@pulsedeck/schema` or any app internals — the
 * demo dogfoods the public HTTP contract. The types below are a local, minimal
 * mirror of the wire shape kept deliberately permissive where the schema is.
 *
 * Across the template set, all 8 block types are exercised:
 *   metric · markdown · chart · table · timeline · alert · status · artifact
 */

// ---------------------------------------------------------------------------
// Wire types (local mirror — see BLOCK_SCHEMA.md). Not imported from the app.
// ---------------------------------------------------------------------------

export type Severity = 'info' | 'warning' | 'critical';
type Status = 'healthy' | 'degraded' | 'down' | 'unknown';
type Trend = 'up' | 'down' | 'flat';
type Sentiment = 'positive' | 'negative' | 'neutral';
type Format = 'number' | 'currency' | 'percent' | 'bytes' | 'duration';
type ChartVariant = 'line' | 'bar' | 'area';
type ColumnType = 'string' | 'number' | 'date';

interface MetricBlock {
  id: string;
  type: 'metric';
  title?: string;
  caption?: string;
  key: string;
  label: string;
  value: number;
  unit?: string;
  format?: Format;
  precision?: number;
  trend?: Trend;
  sentiment?: Sentiment;
  delta?: number;
  comparison_label?: string;
}

interface MarkdownBlock {
  id: string;
  type: 'markdown';
  title?: string;
  caption?: string;
  content: string;
}

interface ChartBlock {
  id: string;
  type: 'chart';
  title?: string;
  caption?: string;
  variant: ChartVariant;
  labels: string[];
  x_axis?: string;
  y_axis?: string;
  unit?: string;
  series: Array<{ name: string; data: number[] }>;
}

interface TableBlock {
  id: string;
  type: 'table';
  title?: string;
  caption?: string;
  columns: Array<{ key: string; label: string; type: ColumnType; unit?: string }>;
  rows: Array<Record<string, string | number>>;
}

interface TimelineBlock {
  id: string;
  type: 'timeline';
  title?: string;
  caption?: string;
  events: Array<{ time: string; label: string; description?: string; status?: Status }>;
}

interface AlertBlock {
  id: string;
  type: 'alert';
  caption?: string;
  severity: Severity;
  title: string;
  message?: string;
}

interface StatusBlock {
  id: string;
  type: 'status';
  title?: string;
  caption?: string;
  items: Array<{ key: string; label: string; status: Status }>;
}

interface ArtifactBlock {
  id: string;
  type: 'artifact';
  title?: string;
  caption?: string;
  label: string;
  url: string;
  mime_type?: string;
  size_bytes?: number;
}

export type Block =
  | MetricBlock
  | MarkdownBlock
  | ChartBlock
  | TableBlock
  | TimelineBlock
  | AlertBlock
  | StatusBlock
  | ArtifactBlock;

/** What a template produces; the CLI wraps it with `version` + `source`. */
export interface ReportInput {
  category: { slug: string };
  stream: { slug: string };
  report: {
    title: string;
    summary?: string;
    severity?: Severity;
    occurred_at: string;
    tags?: string[];
  };
  blocks: Block[];
}

export interface Template {
  /** Human label used in logs. */
  name: string;
  build: (now: Date) => ReportInput;
}

// ---------------------------------------------------------------------------
// Tiny deterministic-ish randomness helpers (Node built-ins only).
// ---------------------------------------------------------------------------

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randFloat = (min: number, max: number, precision = 1): number => {
  const v = Math.random() * (max - min) + min;
  const p = 10 ** precision;
  return Math.round(v * p) / p;
};

const pick = <T>(items: readonly T[]): T => items[randInt(0, items.length - 1)]!;

/** A short random hex id for block ids, e.g. `blk_3f9a`. */
const blk = (prefix: string): string => `blk_${prefix}_${Math.random().toString(16).slice(2, 6)}`;

/** ISO timestamp `minutesAgo` before `now`. */
const minutesAgo = (now: Date, minutes: number): string =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

/** A wiggly series that trends so charts look alive. */
const trendingSeries = (points: number, base: number, drift: number, jitter: number): number[] => {
  const out: number[] = [];
  let value = base;
  for (let i = 0; i < points; i += 1) {
    value += drift + randFloat(-jitter, jitter, 2);
    out.push(Math.max(0, Math.round(value * 100) / 100));
  }
  return out;
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** 1. SEO Audit — metric + table + chart + markdown. */
const seoAudit: Template = {
  name: 'SEO Audit',
  build: (now) => {
    const score = randInt(62, 94);
    const issues = randInt(3, 21);
    const days = 7;
    return {
      category: { slug: 'marketing' },
      stream: { slug: 'seo-audits' },
      report: {
        title: `Weekly SEO Audit — score ${score}`,
        summary: `Crawled 312 URLs. Health score ${score}/100 with ${issues} open issues.`,
        severity: issues > 15 ? 'warning' : 'info',
        occurred_at: minutesAgo(now, randInt(1, 9)),
        tags: ['seo', 'marketing', 'audit'],
      },
      blocks: [
        {
          id: blk('seo_score'),
          type: 'metric',
          key: 'seo_health_score',
          label: 'Health Score',
          value: score,
          unit: '/100',
          format: 'number',
          trend: score >= 80 ? 'up' : 'down',
          sentiment: score >= 80 ? 'positive' : 'negative',
          delta: randInt(-6, 8),
          comparison_label: 'vs last week',
        },
        {
          id: blk('seo_issues'),
          type: 'metric',
          key: 'seo_open_issues',
          label: 'Open Issues',
          value: issues,
          format: 'number',
          trend: 'down',
          sentiment: 'positive',
          delta: -randInt(1, 5),
          comparison_label: 'vs last week',
        },
        {
          id: blk('seo_trend'),
          type: 'chart',
          variant: 'area',
          title: 'Organic Clicks',
          labels: DAY_LABELS.slice(0, days),
          x_axis: 'Day',
          y_axis: 'Clicks',
          unit: 'clicks',
          series: [
            { name: 'Organic', data: trendingSeries(days, randInt(800, 1200), 40, 90) },
            { name: 'Paid', data: trendingSeries(days, randInt(150, 350), 10, 40) },
          ],
        },
        {
          id: blk('seo_pages'),
          type: 'table',
          title: 'Top Pages by Issues',
          columns: [
            { key: 'url', label: 'URL', type: 'string' },
            { key: 'issues', label: 'Issues', type: 'number' },
            { key: 'load', label: 'LCP', type: 'number', unit: 'ms' },
          ],
          rows: [
            { url: '/pricing', issues: randInt(0, 6), load: randInt(900, 2600) },
            { url: '/blog/agent-inbox', issues: randInt(0, 6), load: randInt(900, 2600) },
            { url: '/docs/getting-started', issues: randInt(0, 6), load: randInt(900, 2600) },
            { url: '/changelog', issues: randInt(0, 6), load: randInt(900, 2600) },
          ],
        },
        {
          id: blk('seo_notes'),
          type: 'markdown',
          title: 'Notes',
          content: [
            '## Recommendations',
            '- **Compress hero images** on `/pricing` (saves ~420ms LCP).',
            '- Add `meta description` to 4 changelog entries.',
            '- 2 pages still missing canonical tags.',
          ].join('\n'),
        },
      ],
    };
  },
};

/** 2. Deployment Summary — timeline + status + metric + alert. */
const deploymentSummary: Template = {
  name: 'Deployment Summary',
  build: (now) => {
    const version = `v2.${randInt(3, 19)}.${randInt(0, 9)}`;
    const failed = Math.random() < 0.25;
    const durationS = randInt(48, 240);
    return {
      category: { slug: 'engineering' },
      stream: { slug: 'deployments' },
      report: {
        title: `Deploy ${version} → production`,
        summary: failed
          ? `Deploy ${version} rolled back after failing health checks.`
          : `Deploy ${version} completed in ${durationS}s. All checks green.`,
        severity: failed ? 'critical' : 'info',
        occurred_at: minutesAgo(now, randInt(1, 6)),
        tags: ['ci', 'deploy', failed ? 'rollback' : 'release'],
      },
      blocks: [
        {
          id: blk('dep_timeline'),
          type: 'timeline',
          title: 'Pipeline',
          events: [
            {
              time: minutesAgo(now, 9),
              label: 'Build started',
              description: version,
              status: 'healthy',
            },
            { time: minutesAgo(now, 7), label: 'Tests passed', status: 'healthy' },
            {
              time: minutesAgo(now, 5),
              label: 'Canary rollout',
              description: '10% of fleet',
              status: failed ? 'degraded' : 'healthy',
            },
            failed
              ? {
                  time: minutesAgo(now, 3),
                  label: 'Rolled back',
                  description: 'Error rate breached 2%',
                  status: 'down',
                }
              : { time: minutesAgo(now, 2), label: 'Full rollout complete', status: 'healthy' },
          ],
        },
        {
          id: blk('dep_status'),
          type: 'status',
          title: 'Services',
          items: [
            { key: 'api', label: 'API', status: failed ? 'degraded' : 'healthy' },
            { key: 'worker', label: 'Worker', status: 'healthy' },
            { key: 'web', label: 'Web', status: 'healthy' },
            { key: 'db', label: 'Database', status: 'healthy' },
          ],
        },
        {
          id: blk('dep_dur'),
          type: 'metric',
          key: 'deploy_duration',
          label: 'Deploy Duration',
          value: durationS,
          unit: 's',
          format: 'duration',
          trend: 'flat',
          sentiment: 'neutral',
        },
        {
          id: blk('dep_alert'),
          type: 'alert',
          severity: failed ? 'critical' : 'info',
          title: failed ? 'Deployment rolled back' : 'Deployment succeeded',
          message: failed
            ? `Health checks failed for ${version}; previous version restored automatically.`
            : `${version} is live on 100% of the fleet.`,
        },
      ],
    };
  },
};

/** 3. Daily Revenue Snapshot — metric ×N + chart. */
const revenueSnapshot: Template = {
  name: 'Daily Revenue Snapshot',
  build: (now) => {
    const mrr = randInt(48_000, 96_000);
    const newCustomers = randInt(4, 28);
    const churn = randFloat(0.5, 3.4, 1);
    const days = 7;
    return {
      category: { slug: 'business' },
      stream: { slug: 'revenue' },
      report: {
        title: 'Daily Revenue Snapshot',
        summary: `MRR $${mrr.toLocaleString('en-US')}, ${newCustomers} new customers, ${churn}% churn.`,
        severity: churn > 3 ? 'warning' : 'info',
        occurred_at: minutesAgo(now, randInt(1, 7)),
        tags: ['revenue', 'finance', 'kpi'],
      },
      blocks: [
        {
          id: blk('rev_mrr'),
          type: 'metric',
          key: 'mrr',
          label: 'MRR',
          value: mrr,
          format: 'currency',
          unit: 'USD',
          trend: 'up',
          sentiment: 'positive',
          delta: randInt(400, 3200),
          comparison_label: 'vs yesterday',
        },
        {
          id: blk('rev_new'),
          type: 'metric',
          key: 'new_customers',
          label: 'New Customers',
          value: newCustomers,
          format: 'number',
          trend: 'up',
          sentiment: 'positive',
          delta: randInt(-3, 9),
          comparison_label: 'vs yesterday',
        },
        {
          id: blk('rev_churn'),
          type: 'metric',
          key: 'churn_rate',
          label: 'Churn Rate',
          value: churn,
          unit: '%',
          format: 'percent',
          precision: 1,
          trend: churn > 2 ? 'up' : 'down',
          sentiment: churn > 2 ? 'negative' : 'positive',
          delta: randFloat(-0.6, 0.6, 1),
          comparison_label: 'vs 7d avg',
        },
        {
          id: blk('rev_chart'),
          type: 'chart',
          variant: 'bar',
          title: 'Daily Bookings',
          labels: DAY_LABELS.slice(0, days),
          x_axis: 'Day',
          y_axis: 'USD',
          unit: 'USD',
          series: [{ name: 'Bookings', data: trendingSeries(days, randInt(2000, 5000), 120, 600) }],
        },
      ],
    };
  },
};

/** 4. Infra / Cost report — metric + alert + table. */
const infraCost: Template = {
  name: 'Infra & Cost',
  build: (now) => {
    const spend = randInt(820, 4200);
    const overBudget = spend > 3000;
    return {
      category: { slug: 'engineering' },
      stream: { slug: 'infrastructure' },
      report: {
        title: `Cloud Spend — $${spend.toLocaleString('en-US')} MTD`,
        summary: `Month-to-date cloud spend $${spend.toLocaleString('en-US')} across 5 services.`,
        severity: overBudget ? 'warning' : 'info',
        occurred_at: minutesAgo(now, randInt(2, 11)),
        tags: ['infra', 'cost', 'finops'],
      },
      blocks: [
        {
          id: blk('cost_spend'),
          type: 'metric',
          key: 'cloud_spend_mtd',
          label: 'Spend (MTD)',
          value: spend,
          format: 'currency',
          unit: 'USD',
          trend: 'up',
          sentiment: overBudget ? 'negative' : 'neutral',
          delta: randInt(40, 600),
          comparison_label: 'vs last month',
        },
        {
          id: blk('cost_cpu'),
          type: 'metric',
          key: 'cpu_utilization',
          label: 'Avg CPU',
          value: randInt(28, 81),
          unit: '%',
          format: 'percent',
          trend: pick(['up', 'down', 'flat']),
          sentiment: 'neutral',
        },
        {
          id: blk('cost_alert'),
          type: 'alert',
          severity: overBudget ? 'warning' : 'info',
          title: overBudget ? 'Spend pacing above budget' : 'Spend within budget',
          message: overBudget
            ? 'Projected month-end spend exceeds the $3,000 budget by ~12%. Review the worker autoscaling policy.'
            : 'Projected month-end spend is within the configured budget.',
        },
        {
          id: blk('cost_table'),
          type: 'table',
          title: 'Spend by Service',
          columns: [
            { key: 'service', label: 'Service', type: 'string' },
            { key: 'cost', label: 'Cost', type: 'number', unit: 'USD' },
            { key: 'share', label: 'Share', type: 'number', unit: '%' },
          ],
          rows: [
            { service: 'Compute (ECS)', cost: randInt(300, 1600), share: randInt(20, 45) },
            { service: 'RDS Postgres', cost: randInt(150, 900), share: randInt(10, 30) },
            { service: 'S3', cost: randInt(20, 200), share: randInt(2, 10) },
            { service: 'CloudFront', cost: randInt(30, 300), share: randInt(3, 12) },
            { service: 'Redis', cost: randInt(40, 220), share: randInt(3, 11) },
          ],
        },
      ],
    };
  },
};

/** 5. Incident post-mortem — timeline + markdown + artifact. */
const incidentPostmortem: Template = {
  name: 'Incident Post-Mortem',
  build: (now) => {
    const id = `INC-${randInt(1000, 9999)}`;
    const minutes = randInt(11, 96);
    return {
      category: { slug: 'engineering' },
      stream: { slug: 'incidents' },
      report: {
        title: `${id} Post-Mortem — elevated 5xx`,
        summary: `${minutes}-minute partial outage. Root cause: connection pool exhaustion.`,
        severity: 'critical',
        occurred_at: minutesAgo(now, randInt(3, 14)),
        tags: ['incident', 'postmortem', 'reliability'],
      },
      blocks: [
        {
          id: blk('inc_timeline'),
          type: 'timeline',
          title: 'Timeline',
          events: [
            {
              time: minutesAgo(now, minutes + 4),
              label: 'Alert fired',
              description: '5xx rate > 5%',
              status: 'degraded',
            },
            {
              time: minutesAgo(now, minutes),
              label: 'Incident declared',
              description: 'On-call paged',
              status: 'down',
            },
            {
              time: minutesAgo(now, Math.floor(minutes / 2)),
              label: 'Mitigation applied',
              description: 'Pool size raised 20 → 60',
              status: 'degraded',
            },
            { time: minutesAgo(now, 2), label: 'Resolved', status: 'healthy' },
          ],
        },
        {
          id: blk('inc_writeup'),
          type: 'markdown',
          title: 'Write-up',
          content: [
            `# ${id} — Elevated 5xx`,
            '**Impact:** ~12% of API requests failed for affected users.',
            '',
            '## Root cause',
            'A traffic spike exhausted the Postgres connection pool; new requests',
            'queued past the timeout and returned `503`.',
            '',
            '## Action items',
            '1. Raise pool ceiling and add a saturation alert.',
            '2. Add a load-shedding middleware.',
            '3. Backfill a runbook for pool exhaustion.',
          ].join('\n'),
        },
        {
          id: blk('inc_artifact'),
          type: 'artifact',
          label: 'Full incident report (PDF)',
          url: `https://status.example.com/incidents/${id.toLowerCase()}.pdf`,
          mime_type: 'application/pdf',
          size_bytes: randInt(120_000, 480_000),
        },
      ],
    };
  },
};

/** 6. Reddit / market digest — markdown + table. */
const marketDigest: Template = {
  name: 'Market Digest',
  build: (now) => {
    const mentions = randInt(40, 260);
    const sentiment = pick(['positive', 'neutral', 'negative'] as const);
    return {
      category: { slug: 'marketing' },
      stream: { slug: 'social-digest' },
      report: {
        title: `r/selfhosted digest — ${mentions} mentions`,
        summary: `${mentions} brand-relevant mentions in the last 24h. Overall sentiment: ${sentiment}.`,
        severity: sentiment === 'negative' ? 'warning' : 'info',
        occurred_at: minutesAgo(now, randInt(1, 8)),
        tags: ['social', 'reddit', 'digest'],
      },
      blocks: [
        {
          id: blk('mkt_summary'),
          type: 'markdown',
          title: 'Highlights',
          content: [
            '## What people are saying',
            `- ${randInt(3, 18)} threads asked about **self-hostable agent dashboards**.`,
            '- A comparison post mentioned us alongside two competitors (positive).',
            '- One user hit a Docker networking snag — resolved in-thread.',
          ].join('\n'),
        },
        {
          id: blk('mkt_table'),
          type: 'table',
          title: 'Top Threads',
          columns: [
            { key: 'thread', label: 'Thread', type: 'string' },
            { key: 'upvotes', label: 'Upvotes', type: 'number' },
            { key: 'comments', label: 'Comments', type: 'number' },
            { key: 'mood', label: 'Sentiment', type: 'string' },
          ],
          rows: [
            {
              thread: 'Best dashboard for AI agents?',
              upvotes: randInt(20, 400),
              comments: randInt(5, 120),
              mood: 'positive',
            },
            {
              thread: 'Show HN-style: my homelab inbox',
              upvotes: randInt(20, 400),
              comments: randInt(5, 120),
              mood: 'neutral',
            },
            {
              thread: 'Docker compose networking help',
              upvotes: randInt(5, 80),
              comments: randInt(2, 40),
              mood: 'negative',
            },
          ],
        },
      ],
    };
  },
};

/** The full template set. Rotating through it exercises all 8 block types. */
export const TEMPLATES: readonly Template[] = [
  seoAudit,
  deploymentSummary,
  revenueSnapshot,
  infraCost,
  incidentPostmortem,
  marketDigest,
];
