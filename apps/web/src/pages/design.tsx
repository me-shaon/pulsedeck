import { type ReactNode } from 'react';
import { AlertTriangle, Bell, Copy, Inbox, KeyRound, Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Mono } from '@/components/ui/mono';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { PulseLine } from '@/components/pulse-line';
import { LiveDot } from '@/components/live-dot';

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      </div>
      {children}
    </section>
  );
}

const TINTS: Array<{ name: string; var: string }> = [
  { name: 'bg', var: '--bg' },
  { name: 'surface', var: '--surface' },
  { name: 'surface-2', var: '--surface-2' },
  { name: 'border', var: '--border' },
  { name: 'ink', var: '--ink' },
  { name: 'muted', var: '--muted' },
  { name: 'brand', var: '--brand' },
];

const ROWS = [
  { key: 'src_7f3a91', name: 'api-gateway', status: 'healthy', p95: 142, errors: 0.02 },
  { key: 'src_b20c4e', name: 'billing-worker', status: 'degraded', p95: 488, errors: 1.4 },
  { key: 'src_9d18af', name: 'auth-service', status: 'down', p95: 0, errors: 100.0 },
  { key: 'src_4c77d0', name: 'search-index', status: 'healthy', p95: 96, errors: 0.0 },
];

export function DesignPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Signature hero */}
      <header className="flex flex-col gap-4 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              PulseDeck — Design System
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              A calm instrument panel for agent reports
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Machine-precise data on a quiet, human-readable surface. Signal over noise — restraint
              everywhere except one signature: the pulse.
            </p>
          </div>
          <Badge variant="brand" dot>
            Phase 7
          </Badge>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-4">
            <div className="flex items-center gap-3">
              <LiveDot color="brand" size={10} />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Report cadence · live</span>
                <span className="tabular text-sm font-medium">
                  1,284 reports <span className="text-muted-foreground">in the last 24h</span>
                </span>
              </div>
            </div>
            <PulseLine width={320} height={44} beats={6} speed={4} className="text-brand" />
          </CardContent>
        </Card>
      </header>

      <div className="flex flex-col gap-6">
        {/* Buttons */}
        <Section
          title="Buttons"
          caption="One restrained brand moment; everything else stays quiet."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary">
              <Plus /> Small
            </Button>
            <Button size="md" variant="secondary">
              Medium
            </Button>
            <Button size="lg" variant="outline">
              Large
            </Button>
            <Button size="icon" variant="outline" aria-label="Settings">
              <SlidersHorizontal />
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </div>
        </Section>

        {/* Form controls */}
        <Section title="Inputs & Select">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="Filter sources…" aria-label="Filter" />
            <Input type="email" placeholder="agent@workspace" aria-label="Email" />
            <Select defaultValue="all">
              <SelectTrigger aria-label="Severity filter">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Section>

        {/* Badges — the domain palette */}
        <Section
          title="Status pills"
          caption="Semantic colors fixed to domain enums — never the brand hue, so a reader can trust the color."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-muted-foreground">severity</span>
              <Badge variant="info" dot>
                info
              </Badge>
              <Badge variant="warning" dot>
                warning
              </Badge>
              <Badge variant="critical" dot>
                critical
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-muted-foreground">status</span>
              <Badge variant="healthy" dot>
                healthy
              </Badge>
              <Badge variant="degraded" dot>
                degraded
              </Badge>
              <Badge variant="down" dot>
                down
              </Badge>
              <Badge variant="unknown" dot>
                unknown
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-muted-foreground">sentiment</span>
              <Badge variant="positive" dot>
                positive
              </Badge>
              <Badge variant="negative" dot>
                negative
              </Badge>
              <Badge variant="neutralSentiment" dot>
                neutral
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-muted-foreground">generic</span>
              <Badge variant="neutral">neutral</Badge>
              <Badge variant="brand">brand</Badge>
              <Badge variant="outline">outline</Badge>
              <Badge variant="solid">solid</Badge>
            </div>
          </div>
        </Section>

        {/* Metrics — tabular figures + mono identifiers */}
        <Section
          title="Metric cards"
          caption="Tabular figures for numerals; Geist Mono for machine identifiers."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Reports / min</CardDescription>
                <CardTitle className="tabular text-display font-semibold leading-none">
                  53.2
                </CardTitle>
              </CardHeader>
              <CardFooter className="text-xs text-muted-foreground">
                <Badge variant="positive">+12%</Badge>
                <span>vs last hour</span>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Active sources</CardDescription>
                <CardTitle className="tabular text-display font-semibold leading-none">
                  47
                </CardTitle>
              </CardHeader>
              <CardFooter className="gap-2 text-xs text-muted-foreground">
                <LiveDot color="healthy" size={7} />
                <span>43 healthy · 3 degraded · 1 down</span>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Idempotency key</CardDescription>
                <CardTitle className="text-base">
                  <Mono as="span" className="text-foreground">
                    pd_idmp_5f29c1a0
                  </Mono>
                </CardTitle>
              </CardHeader>
              <CardFooter className="text-xs">
                <Mono>2026-06-20T11:42:08Z</Mono>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* Table */}
        <Section title="Table" caption="Hairline rules, tabular numerals, mono source ids.">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">p95 (ms)</TableHead>
                  <TableHead className="text-right">Errors %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROWS.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <LiveDot
                          color={r.status === 'down' ? 'down' : 'healthy'}
                          live={r.status !== 'down'}
                          size={7}
                        />
                        {r.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Mono>{r.key}</Mono>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status as 'healthy' | 'degraded' | 'down'}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.p95}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.errors.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </Section>

        {/* Tabs */}
        <Section title="Tabs">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="schema">Schema</TabsTrigger>
              <TabsTrigger value="raw">Raw</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p className="text-sm text-muted-foreground">
                A briefing-density summary lives here. Never a data-dump.
              </p>
            </TabsContent>
            <TabsContent value="schema">
              <p className="text-sm text-muted-foreground">
                Block schema fields, rendered as a quiet definition list.
              </p>
            </TabsContent>
            <TabsContent value="raw">
              <Mono as="p" className="text-foreground">
                {'{ "type": "metric", "key": "reports.rate", "value": 53.2 }'}
              </Mono>
            </TabsContent>
          </Tabs>
        </Section>

        {/* Overlays + toast */}
        <Section title="Overlays & toasts">
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="primary">
                  <KeyRound /> Rotate API key
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rotate API key</DialogTitle>
                  <DialogDescription>
                    The current key stops working immediately. Update your agents with the new
                    value.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
                  <Mono className="flex-1 text-foreground">pd_live_9b21f0c4e7a1</Mono>
                  <Button size="icon" variant="ghost" aria-label="Copy key">
                    <Copy />
                  </Button>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="primary">Rotate</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <SlidersHorizontal /> Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Source</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Bell /> Mute alerts
                </DropdownMenuItem>
                <DropdownMenuItem>
                  Pin to top
                  <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-severity-critical focus:text-severity-critical">
                  Remove source
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="secondary"
              onClick={() =>
                toast('Source connected', {
                  description: 'src_7f3a91 started reporting.',
                })
              }
            >
              <Bell /> Trigger toast
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast.error('Auth service is down', {
                  description: 'No reports received for 4m.',
                })
              }
            >
              <AlertTriangle /> Error toast
            </Button>
          </div>
        </Section>

        {/* Loading + empty */}
        <Section title="Loading & empty states">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Loading</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
            <EmptyState
              icon={Inbox}
              title="No reports yet"
              description="Point an agent at this workspace and reports will stream in here."
              action={
                <Button variant="primary" size="sm">
                  <Plus /> Connect a source
                </Button>
              }
            />
          </div>
        </Section>

        {/* Typography + tokens */}
        <Section
          title="Type & tokens"
          caption="Geist Sans for UI; Geist Mono for machine identifiers only."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-display font-semibold leading-none tabular">36 · Display</p>
              <p className="text-2xl font-semibold">22 · Heading</p>
              <p className="text-base">14 · Body — the calm reading size.</p>
              <p className="text-sm text-muted-foreground">13 · Secondary / muted.</p>
              <Mono as="p" className="text-foreground">
                13 · Mono — src_7f3a91 · pd_live_…
              </Mono>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {TINTS.map((t) => (
                <div key={t.var} className="flex flex-col items-center gap-1">
                  <span
                    className="size-9 rounded-md border border-border"
                    style={{ background: `var(${t.var})` }}
                  />
                  <span className="text-[0.625rem] text-muted-foreground">{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        <Mono>prefers-reduced-motion respected · contrast AA · brand focus ring</Mono>
      </footer>
    </div>
  );
}
