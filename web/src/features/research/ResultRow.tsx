import React from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Landmark, UserRound, CalendarClock } from "lucide-react";

type ResultRowProps = {
  idx?: number;
  fromApi?: boolean;
  item?: {
    relevance?: number;
    similarity?: number;
    title?: string;
    snippet?: string;
    court?: string;
    judge?: string;
    date?: string;
    langs?: string[];
    docType?: string | null;
    citation?: string | null;
    path?: string | null;
    chunkCount?: number;
    chunkIds?: string[];
  };
  onOpen?: () => void;
  onAddToBrief?: () => void;
};

const ResultRow: React.FC<ResultRowProps> = ({
  idx = 1,
  fromApi = false,
  item,
  onOpen,
  onAddToBrief,
}) => {
  const fallbackRelevance = Math.max(40, 92 - idx * 4);
  const computedRelevance = (() => {
    if (!fromApi) return fallbackRelevance;
    if (typeof item?.relevance === "number" && Number.isFinite(item.relevance)) return item.relevance;
    if (typeof item?.similarity === "number" && Number.isFinite(item.similarity)) {
      return Math.round(Math.max(0, Math.min(1, item.similarity)) * 100);
    }
    return fallbackRelevance;
  })();
  const relevance = Math.max(0, Math.min(100, computedRelevance));
  const title = item?.title?.trim() || `Sample case ${idx}`;
  const snippet =
    item?.snippet?.trim() ||
    "Held that contractual indemnity clauses must be construed strictly; discusses sections 73 and 74 of the Indian Contract Act.";
  const court = item?.court?.trim() || "Supreme Court";
  const judge = item?.judge?.trim() || "Chandrachud J.";
  const date = item?.date?.trim() || "12 Jan 2021";
  const languages = item?.langs && item.langs.length ? item.langs : ["EN"];
  const docType = item?.docType?.trim() || null;
  const citation = item?.citation?.trim() || null;
  const path = item?.path?.trim() || null;
  const chunkCount = typeof item?.chunkCount === "number" && Number.isFinite(item.chunkCount)
    ? Math.max(0, Math.floor(item.chunkCount))
    : undefined;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 transition hover:border-emerald-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-emerald-400">
      {/* LEFT: Content */}
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className="rounded-xl" variant="secondary">
            Relevance {relevance.toFixed(0)}%
          </Badge>
          {typeof chunkCount === "number" && chunkCount > 0 && (
            <Badge className="rounded-xl" variant="outline">
              {chunkCount} chunk{chunkCount === 1 ? "" : "s"}
            </Badge>
          )}
          {docType ? (
            <Badge className="rounded-xl" variant="outline">
              {docType}
            </Badge>
          ) : (
            <Badge className="rounded-xl" variant="outline">
              Retrieved
            </Badge>
          )}
          <Badge className="rounded-xl" variant="outline">
            {languages.join(" / ")}
          </Badge>
        </div>
        <div className="text-sm font-semibold leading-tight">{title}</div>
        <div className="text-sm text-neutral-600 dark:text-neutral-300">{snippet}</div>
        {citation && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400">Citation: {citation}</div>
        )}
        {path && (
          <div className="text-[11px] text-neutral-500 dark:text-neutral-500" title={path}>
            Source: {path}
          </div>
        )}
      </div>

      {/* RIGHT: Actions */}
      <div className="flex-shrink-0 w-56 sm:w-64 space-y-2 text-xs">
        <div className="text-neutral-500 dark:text-neutral-400">Source coverage</div>
        <Progress value={Math.max(10, Math.min(100, relevance))} className="h-2" />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 rounded-xl" onClick={onOpen}>
            Open
          </Button>
          <Button size="sm" className="flex-1 rounded-xl" onClick={onAddToBrief}>
            Add to Brief
          </Button>
        </div>
        {typeof chunkCount === "number" && (
          <div className="text-[11px] text-neutral-500 dark:text-neutral-500">
            Based on {chunkCount} chunk{chunkCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultRow;
