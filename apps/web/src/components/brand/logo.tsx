import { cn } from '@/lib/utils';

/**
 * PulseDeck wordmark. Theme-aware, both variants keep the teal pulse bar:
 *   - light → logo-light: grey bars + teal accent + near-black text.
 *   - dark  → logo: grey bars + teal accent + near-white text.
 * (The stock logo.svg ships near-white text for dark surfaces; logo-light is the
 * same artwork with the text recoloured for light backgrounds.)
 * Assets live in /public and are served from the site root, so they are plain
 * <img> requests rather than bundled imports.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <>
      <img
        src="/pulsedeck-logo-light.svg"
        alt="PulseDeck"
        width={372}
        height={100}
        className={cn('block h-8 w-auto dark:hidden', className)}
      />
      <img
        src="/pulsedeck-logo.svg"
        alt="PulseDeck"
        width={372}
        height={100}
        aria-hidden
        className={cn('hidden h-8 w-auto dark:block', className)}
      />
    </>
  );
}

/**
 * Square brand mark (no wordmark). Colour version reads on either theme thanks
 * to the teal accent bar; swap to mono-white on dark for crisper edges.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <>
      <img
        src="/pulsedeck-mark.svg"
        alt="PulseDeck"
        width={100}
        height={100}
        className={cn('block size-6 dark:hidden', className)}
      />
      <img
        src="/pulsedeck-mark-mono-white.svg"
        alt="PulseDeck"
        width={100}
        height={100}
        aria-hidden
        className={cn('hidden size-6 dark:block', className)}
      />
    </>
  );
}
