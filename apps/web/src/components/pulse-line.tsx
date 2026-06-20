import * as React from 'react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/*
 * THE SIGNATURE.
 * A hairline ECG / sparkline "heartbeat" of report cadence. This is the one
 * memorable, deliberately-bold element — everything else in the system stays
 * quiet. A faint full trace sits underneath; a luminous "comet" rides along it
 * to imply a live pulse.
 *
 * Accessibility: honors prefers-reduced-motion by rendering a crisp STATIC line
 * (no traveling comet, no draw animation).
 */

export interface PulseLineProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number;
  height?: number;
  /** Roughly how many heartbeats to draw across the width. */
  beats?: number;
  /** Speed of the traveling pulse, in seconds per loop. */
  speed?: number;
  /** When false, renders only the static trace (no comet) even with motion on. */
  live?: boolean;
}

const PATH_LENGTH = 1000;

/** Build a deterministic ECG waveform path across the viewBox. */
function buildEcgPath(width: number, height: number, beats: number): string {
  const baseline = height * 0.56;
  const beatWidth = width / beats;
  // Relative keypoints within one beat (x fraction, y offset from baseline).
  const beat: Array<[number, number]> = [
    [0.0, 0],
    [0.12, 0],
    [0.18, -0.12 * height], // p-wave
    [0.24, 0],
    [0.34, 0.06 * height], // q dip
    [0.4, -0.42 * height], // R spike (the heartbeat)
    [0.46, 0.22 * height], // s trough
    [0.52, 0],
    [0.66, -0.16 * height], // t-wave
    [0.78, 0],
    [1.0, 0],
  ];

  let d = '';
  for (let i = 0; i < beats; i += 1) {
    const x0 = i * beatWidth;
    for (const [fx, dy] of beat) {
      const x = +(x0 + fx * beatWidth).toFixed(2);
      const y = +(baseline + dy).toFixed(2);
      d += d === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
  }
  return d;
}

export function PulseLine({
  width = 280,
  height = 40,
  beats = 5,
  speed = 4,
  live = true,
  className,
  ...props
}: PulseLineProps) {
  const reduced = usePrefersReducedMotion();
  const id = React.useId().replace(/:/g, '');
  const d = React.useMemo(() => buildEcgPath(width, height, beats), [width, height, beats]);
  const animate = live && !reduced;

  return (
    <div
      {...props}
      role="img"
      aria-label="Report cadence pulse"
      className={cn('inline-block leading-none text-brand', className)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        <defs>
          {/* Left-edge fade so the trace appears to emerge from the past. */}
          <linearGradient id={`fade-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.12" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
          </linearGradient>
          <filter id={`glow-${id}`} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Faint full trace. */}
        <path
          d={d}
          stroke={`url(#fade-${id})`}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {animate ? (
          /* Luminous comet riding the trace (CSS keyframes on dashoffset). */
          <path
            d={d}
            pathLength={PATH_LENGTH}
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            filter={`url(#glow-${id})`}
            className="pulse-comet"
            style={
              {
                '--pulse-len': PATH_LENGTH,
                '--pulse-speed': `${speed}s`,
              } as React.CSSProperties
            }
          />
        ) : (
          /* Reduced-motion / static: crisp full-strength line, no movement. */
          <path
            d={d}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}
