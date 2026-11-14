"use client";

// Generic data table with responsive card fallback, loading/empty states and
// client-side pagination. Every admin/portal table in the platform uses it.

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toFaDigits } from "@/lib/format/fa";
import { EmptyState, ErrorState, SkeletonRows } from "./ui";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Hide this column on small screens (table renders the mobile card instead). */
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle = "موردی ثبت نشده است",
  emptyDescription,
  emptyAction,
  mobileCard,
  pageSize = 10,
  onRowClick,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  mobileCard?: (row: T) => ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );

  if (loading) {
    return (
      <div className={cn("rounded-xl border bg-card p-4", className)}>
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} className={className} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Desktop table */}
      <div className={cn("hidden overflow-hidden rounded-xl border bg-card md:block", className)}>
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-start">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-start text-[11px] font-bold text-muted-foreground",
                      col.className,
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border/60 transition-colors last:border-0",
                    onRowClick && "cursor-pointer hover:bg-accent/60",
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-3 align-middle", col.className)}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pageRows.map((row) =>
          mobileCard ? (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("rounded-xl border bg-card p-4", onRowClick && "cursor-pointer active:bg-accent/60")}
            >
              {mobileCard(row)}
            </div>
          ) : (
            <div key={rowKey(row)} className="rounded-xl border bg-card p-4">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
                  <span className="text-[11px] font-bold text-muted-foreground">{col.header}</span>
                  <span className="text-xs">{col.cell(row)}</span>
                </div>
              ))}
            </div>
          ),
        )}
      </div>

      {/* Pagination */}
      {rows.length > pageSize ? (
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            {toFaDigits(rows.length)} مورد — صفحه {toFaDigits(safePage)} از {toFaDigits(pageCount)}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              className="rounded-lg border p-2 transition-colors hover:bg-accent disabled:opacity-40"
              aria-label="صفحه قبل"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              disabled={safePage >= pageCount}
              onClick={() => setPage(safePage + 1)}
              className="rounded-lg border p-2 transition-colors hover:bg-accent disabled:opacity-40"
              aria-label="صفحه بعد"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
