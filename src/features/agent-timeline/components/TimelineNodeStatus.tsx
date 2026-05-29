"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  CircleSlash2,
  LoaderCircle,
  PencilLine,
  RefreshCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { TimelineNodeStatus as TimelineNodeStatusValue } from "@/features/agent-timeline";
import { cn } from "@/shared/utils/cn";

type StatusConfig = {
  label: string;
  icon: LucideIcon;
  className: string;
};

const statusConfig: Record<TimelineNodeStatusValue, StatusConfig> = {
  blocked: {
    label: "Blocked",
    icon: CircleSlash2,
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
  ready: {
    label: "Ready",
    icon: CircleDot,
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  running: {
    label: "Running",
    icon: LoaderCircle,
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  done: {
    label: "Done",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  stale: {
    label: "Stale",
    icon: RefreshCcw,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  error: {
    label: "Error",
    icon: AlertTriangle,
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  manual: {
    label: "Manual",
    icon: PencilLine,
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

export function TimelineNodeStatus({ status }: { status: TimelineNodeStatusValue }) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold uppercase tracking-wide",
        config.className,
      )}
    >
      <Icon className={cn("size-3.5", status === "running" && "animate-spin")} />
      {config.label}
    </span>
  );
}
