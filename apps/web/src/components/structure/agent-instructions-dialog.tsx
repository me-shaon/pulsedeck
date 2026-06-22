import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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
 */
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
  const [result, setResult] = useState<AgentInstructions | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setSourceId('');
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
              className="text-brand underline"
              onClick={() => onOpenChange(false)}
            >
              Sources
            </Link>{' '}
            page, then come back to copy instructions.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Source (agent)</span>
              <div className="flex items-center gap-2">
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="flex-1" aria-label="Source">
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
                <Button
                  variant="primary"
                  onClick={generate}
                  disabled={!sourceId || instructions.isPending}
                >
                  {instructions.isPending ? 'Generating…' : result ? 'Regenerate' : 'Generate'}
                </Button>
              </div>
            </div>

            {error ? <p className="text-xs text-destructive">{errorMessage(error)}</p> : null}

            {result ? (
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
                  <p className="text-[0.6875rem] text-muted-foreground">
                    Contains a one-time registration token — it expires in 24h. Regenerate if it
                    lapses.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
