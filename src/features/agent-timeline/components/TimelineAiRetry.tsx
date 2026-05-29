"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

type TimelineAiRetryProps = {
  disabled?: boolean;
  label: string;
  onRequest: () => void;
};

export function TimelineAiRetry({ disabled = false, label, onRequest }: TimelineAiRetryProps) {
  return (
    <Button
      className="h-8 shrink-0 px-2.5 text-xs shadow-none"
      disabled={disabled}
      onClick={onRequest}
      title={disabled ? "AI action is waiting for this node to become available" : label}
      type="button"
      variant="secondary"
    >
      <Sparkles className="size-3.5" />
      {label}
    </Button>
  );
}
