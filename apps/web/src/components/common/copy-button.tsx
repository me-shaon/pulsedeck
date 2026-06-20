import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

/** Copy-to-clipboard button with transient confirmation. */
export function CopyButton({
  value,
  label = 'Copy',
  className,
  variant = 'outline',
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Couldn’t copy — copy it manually.');
    }
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={cn(className)}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  );
}
