import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/common/copy-button';
import { errorMessage } from '@/components/common/states';
import { useAgentInstructions, useSources } from '@/hooks/use-workspace-data';
import type { AgentInstructions } from '@/lib/api-types';

/**
 * Copy a destination-scoped agent instruction. Pick a source (the agent that
 * will push), then a paste-ready prompt is generated with the target
 * category/stream slug pre-filled and a fresh one-time registration token. The
 * operator pastes it into their agent (Claude Code, Cursor, …) and is done.
 *
 * Visual language mirrors {@link SecretRevealDialog}: a labelled field, a code
 * block with an inline copy affordance, and a single primary footer action.
 */
const fieldLabel = 'text-xs font-medium text-muted-foreground';

export function AgentInstructionsDialog({
  open,
  onOpenChange,
  wsId,
  wsSlug,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  wsSlug: string;
  target: { kind: 'category' | 'stream'; id: string; name: string } | null;
}) {
  const sources = useSources(wsId, open);
  const instructions = useAgentInstructions(wsId);
  const [sourceId, setSourceId] = useState<string>('');
  const [task, setTask] = useState<string>('');
  const [result, setResult] = useState<AgentInstructions | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setSourceId('');
      setTask('');
      setResult(null);
      setError(null);
    }
  }, [open, target?.id]);

  async function generate() {
    if (!sourceId || !target) return;
    setError(null);
    try {
      const res = await instructions.mutateAsync({
        kind: target.kind,
        id: target.id,
        sourceId,
        task: task.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(e);
    }
  }

  const noSources = sources.data && sources.data.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Agent instructions{target ? ` — ${target.name}` : ''}</DialogTitle>
          <DialogDescription>
            {target?.kind === 'stream'
              ? 'A paste-ready prompt that points an agent at this stream.'
              : 'A paste-ready prompt that points an agent at this category.'}
          </DialogDescription>
        </DialogHeader>

        {noSources ? (
          <p className="text-sm text-muted-foreground">
            No sources yet. Create one on the{' '}
            <Link
              to="/w/$ws/sources"
              params={{ ws: wsSlug }}
              className="font-medium text-brand underline-offset-2 hover:underline"
              onClick={() => onOpenChange(false)}
            >
              Sources
            </Link>{' '}
            page, then come back to copy instructions.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Source (agent)</span>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger aria-label="Source">
                  <SelectValue placeholder="Choose a source…" />
                </SelectTrigger>
                <SelectContent>
                  {sources.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!result ? (
              <div className="flex flex-col gap-1.5">
                <span className={fieldLabel}>What should this agent do? (optional)</span>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="e.g. Every 5 minutes, HTTP-check these URLs and report up/down + latency: https://…"
                  data-ring="self"
                  className="w-full rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-foreground shadow-[inset_0_1px_0_0_rgba(0,0,0,0.02)] transition-colors placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-[0.6875rem] text-muted-foreground">
                  Woven into the prompt as the agent’s task. Not stored.
                </p>
              </div>
            ) : null}

            {error ? <p className="text-xs text-destructive">{errorMessage(error)}</p> : null}

            {!result ? (
              <Button
                variant="primary"
                className="w-full"
                onClick={generate}
                disabled={!sourceId || instructions.isPending}
              >
                {instructions.isPending ? 'Generating…' : 'Generate instructions'}
              </Button>
            ) : (
              <>
                {result.baseUrlNote ? (
                  <div className="flex items-start gap-2 rounded-md border border-[var(--severity-warning)]/40 bg-[var(--tint-amber-bg)] px-3 py-2 text-xs">
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-severity-warning"
                      aria-hidden
                    />
                    <span className="text-foreground">{result.baseUrlNote}</span>
                  </div>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                      Agent prompt
                    </span>
                    <CopyButton value={result.setupPrompt} label="Copy prompt" size="sm" />
                  </div>
                  <pre className="mono max-h-72 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
                    {result.setupPrompt}
                  </pre>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.6875rem] text-muted-foreground">
                      Contains a one-time registration token — expires in 24h.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={generate}
                      disabled={instructions.isPending}
                    >
                      <RotateCw className="size-3.5" />
                      {instructions.isPending ? 'Regenerating…' : 'Regenerate'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant={result ? 'primary' : 'ghost'} onClick={() => onOpenChange(false)}>
            {result ? 'Done' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
