import { useMemo, useState } from 'react';
import type { ColumnType, TableBlock as TableBlockT } from '@pulsedeck/schema';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCell } from '@/lib/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BlockFrame } from './block-frame';

/**
 * table — typed columns + keyed rows.
 *
 * REAL-TYPE SORT: a `number` column sorts numerically (890 > 42, not "890" <
 * "42"), a `date` column sorts chronologically, a `string` column sorts with
 * locale compare. Null/undefined always sink to the bottom. Sorting is
 * keyboard-operable (header is a button) and announces direction via
 * `aria-sort`.
 */

type SortDir = 'asc' | 'desc';

/** Compare two raw cell values by their declared column type. */
function compareByType(a: unknown, b: unknown, type: ColumnType): number {
  const aNil = a === null || a === undefined || a === '';
  const bNil = b === null || b === undefined || b === '';
  if (aNil && bNil) return 0;
  if (aNil) return 1; // nils sink
  if (bNil) return -1;

  if (type === 'number') {
    return Number(a) - Number(b);
  }
  if (type === 'date') {
    return new Date(String(a)).getTime() - new Date(String(b)).getTime();
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function TableBlock({ block }: { block: TableBlockT }) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return block.rows;
    const col = block.columns.find((c) => c.key === sort.key);
    if (!col) return block.rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    // Copy before sort — never mutate the prop array.
    return [...block.rows].sort(
      (ra, rb) => factor * compareByType(ra[col.key], rb[col.key], col.type),
    );
  }, [block.rows, block.columns, sort]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click clears sort
    });
  }

  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {block.columns.map((col) => {
                const dir = sort?.key === col.key ? sort.dir : undefined;
                const active = dir !== undefined;
                const ariaSort =
                  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
                const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown;
                return (
                  <TableHead
                    key={col.key}
                    aria-sort={ariaSort}
                    className={cn(col.type === 'number' && 'text-right')}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      data-ring="self"
                      className={cn(
                        'group inline-flex items-center gap-1 rounded px-0.5 text-xs font-medium transition-colors',
                        'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        col.type === 'number' && 'flex-row-reverse',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span>
                        {col.label}
                        {col.unit ? (
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({col.unit})
                          </span>
                        ) : null}
                      </span>
                      <Icon
                        className={cn(
                          'size-3',
                          active ? 'opacity-90' : 'opacity-0 group-hover:opacity-50',
                        )}
                        aria-hidden
                      />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={block.columns.length}
                  className="py-6 text-center text-muted-foreground"
                >
                  No rows.
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row, i) => (
                <TableRow key={i}>
                  {block.columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(col.type === 'number' && 'text-right tabular-nums')}
                    >
                      {formatCell(row[col.key], col.type, col.unit)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </BlockFrame>
  );
}
