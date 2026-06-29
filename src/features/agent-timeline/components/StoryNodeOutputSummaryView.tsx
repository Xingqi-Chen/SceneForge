"use client";

import {
  createStoryNodeOutputSummary,
  type StoryShotSummaryCard,
  type StoryShotSummaryTone,
} from "@/features/agent-timeline/story-node-output-summary";
import type {
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";

type StoryNodeOutputSummaryViewProps = {
  nodeId: StoryWorkflowNodeId;
  result: unknown;
};

function isPromptColumn(column: string) {
  return /\b(?:positive|negative)?prompt\b/i.test(column) || /sections?/i.test(column);
}

function isLongValue(value: string) {
  return value.length > 140 || value.includes("\n");
}

function SummaryValue({
  column,
  value,
}: {
  column?: string;
  value: string;
}) {
  const longValue = isLongValue(value);
  const promptValue = column ? isPromptColumn(column) : false;

  if (!longValue) {
    return <span className="whitespace-pre-wrap break-words">{value || "-"}</span>;
  }

  return (
    <pre
      className={[
        "custom-scrollbar max-h-72 min-w-[18rem] select-text overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 leading-relaxed text-slate-700",
        promptValue ? "font-mono text-[11px]" : "font-sans text-xs",
      ].join(" ")}
    >
      {value || "-"}
    </pre>
  );
}

function SummaryTable({ rows }: { rows: Record<string, string>[] }) {
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  if (rows.length === 0 || columns.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-xs">
        <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
          <tr>
            {columns.map((column) => (
              <th className="px-2 py-2 text-left font-semibold" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td className="max-w-[36rem] px-2 py-2 align-top leading-relaxed" key={column}>
                  <SummaryValue column={column} value={row[column] || ""} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getToneClassName(tone: StoryShotSummaryTone) {
  if (tone === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (tone === "review") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function SummaryPill({
  label,
  tone,
}: {
  label: string;
  tone: StoryShotSummaryTone;
}) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${getToneClassName(tone)}`}>
      {label}
    </span>
  );
}

function SummaryTextBlock({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) {
    return null;
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <SummaryValue column={label} value={value} />
    </div>
  );
}

function WarningList({
  items,
  title,
}: {
  items?: string[];
  title: string;
}) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
      <p className="text-[11px] font-semibold uppercase text-amber-800">{title}</p>
      <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-amber-800">
        {items.map((item, index) => (
          <li key={`${item}:${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AnimaPromptPartsGrid({ card }: { card: StoryShotSummaryCard }) {
  const parts = card.animaPromptParts ?? [];

  if (parts.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase text-slate-500">Anima prompt parts</p>
      <dl className="mt-2 grid gap-x-3 gap-y-2 text-xs sm:grid-cols-[7rem_1fr]">
        {parts.map((part) => (
          <div className="contents" key={part.label}>
            <dt className="text-[11px] font-semibold uppercase text-slate-500">{part.label}</dt>
            <dd className="min-w-0 leading-relaxed text-slate-700">
              <SummaryValue column={part.label} value={part.value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StoryShotCard({ card }: { card: StoryShotSummaryCard }) {
  return (
    <article className="overflow-hidden rounded-md border border-slate-200 bg-white" data-testid="story-shot-card">
      <div className="grid gap-0 md:grid-cols-[11rem_1fr]">
        <div className="flex min-h-40 items-center justify-center border-b border-slate-200 bg-slate-100 md:border-b-0 md:border-r">
          {card.imageUrl ? (
            <a className="flex size-full items-center justify-center p-2" href={card.imageUrl} rel="noreferrer" target="_blank">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`Shot ${card.shotNumber} ${card.title}`}
                className="max-h-40 max-w-full rounded object-contain"
                src={card.imageUrl}
              />
            </a>
          ) : (
            <div className="flex size-full min-h-40 flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-slate-500">
              <span className="font-semibold uppercase text-slate-400">No image</span>
              {card.imageLabel ? <span className="break-all">{card.imageLabel}</span> : <span>Preview pending</span>}
            </div>
          )}
        </div>
        <div className="min-w-0 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Shot {card.shotNumber} / {card.shotId}
              </p>
              <h4 className="mt-1 text-sm font-semibold text-slate-950">{card.title}</h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{card.sceneBeat}</p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <SummaryPill label={card.readinessLabel} tone={card.readinessTone} />
              <SummaryPill label={card.promptHealth.label} tone={card.promptHealth.tone} />
              {card.status ? <SummaryPill label={card.status} tone="neutral" /> : null}
            </div>
          </div>

          <dl className="mt-3 grid gap-x-3 gap-y-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase text-slate-500">Source</dt>
              <dd className="mt-1 leading-relaxed text-slate-700">{card.dependencies}</dd>
            </div>
            {card.parameters ? (
              <div>
                <dt className="text-[11px] font-semibold uppercase text-slate-500">Parameters</dt>
                <dd className="mt-1 leading-relaxed text-slate-700">{card.parameters}</dd>
              </div>
            ) : null}
            {card.locationContinuity ? (
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-semibold uppercase text-slate-500">Location continuity</dt>
                <dd className="mt-1 leading-relaxed text-slate-700">{card.locationContinuity}</dd>
              </div>
            ) : null}
            {card.resources ? (
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-semibold uppercase text-slate-500">Resources</dt>
                <dd className="mt-1 leading-relaxed text-slate-700">{card.resources}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-3 grid gap-3">
            <AnimaPromptPartsGrid card={card} />
            <SummaryTextBlock label="Reference recipe" value={card.referenceRecipe} />
            <SummaryTextBlock label="Visual prompt" value={card.visualPrompt} />
            <SummaryTextBlock label="Negative prompt" value={card.negativePrompt} />
            {card.readinessDetail ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                {card.readinessDetail}
              </p>
            ) : null}
            <WarningList
              items={card.promptHealth.issues.map((issue) => `${issue.label}: ${issue.detail}`)}
              title="Prompt health"
            />
            <WarningList items={card.warnings} title="Warnings" />
            <WarningList items={card.removedNegatives} title="Removed negatives" />
            <WarningList
              items={card.sourceRisks.map((risk) => `${risk.label}: ${risk.detail}`)}
              title="Source-image risk"
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export function StoryNodeOutputSummaryView({
  nodeId,
  result,
}: StoryNodeOutputSummaryViewProps) {
  const summary = createStoryNodeOutputSummary(nodeId, result);

  return (
    <div className="flex flex-col gap-3" data-testid="story-node-output-summary">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">{summary.title}</h3>
      </div>
      {summary.metrics.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {summary.metrics.map((metric) => (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2" key={metric.label}>
              <dt className="text-[11px] font-semibold uppercase text-slate-500">{metric.label}</dt>
              <dd className="mt-1 text-xs font-medium leading-relaxed text-slate-800">
                <SummaryValue value={metric.value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {summary.shotCards && summary.shotCards.length > 0 ? (
        <div className="grid gap-3" data-testid="story-shot-card-list">
          {summary.shotCards.map((card) => (
            <StoryShotCard card={card} key={`${card.shotId}:${card.shotNumber}`} />
          ))}
        </div>
      ) : null}
      {summary.sections.map((section) => {
        const hasRows = section.rows && section.rows.length > 0;
        const hasFields = section.fields && section.fields.length > 0;
        const hasNotes = section.notes && section.notes.length > 0;

        return (
          <section className="rounded-md border border-slate-200 bg-white p-3" key={section.title}>
            <h4 className="text-xs font-semibold text-slate-900">{section.title}</h4>
            {hasFields ? (
              <dl className="mt-2 grid gap-x-3 gap-y-2 text-xs sm:grid-cols-[8rem_1fr]">
                {section.fields?.map((field) => (
                  <div className="contents" key={field.label}>
                    <dt className="text-slate-500">{field.label}</dt>
                    <dd className="min-w-0 leading-relaxed text-slate-700">
                      <SummaryValue column={field.label} value={field.value || ""} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {hasRows ? (
              <div className={hasFields ? "mt-3" : "mt-2"}>
                <SummaryTable rows={section.rows ?? []} />
              </div>
            ) : null}
            {hasNotes ? (
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-700">
                {section.notes?.map((note, index) => (
                  <li key={`${note}:${index}`}>{note}</li>
                ))}
              </ul>
            ) : null}
            {!hasRows && !hasFields && !hasNotes ? (
              <p className="mt-2 text-xs text-slate-500">{section.emptyState ?? "No summary details."}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
