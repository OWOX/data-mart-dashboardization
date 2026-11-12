import { z } from 'zod';
import type { GenerateWith } from '../model/interpret';
import { DATE_TYPES, flattenFields } from '../owox/sources';
import { INDUSTRIES } from '../model/core';
import { upsertMetricsTable } from './tables';
import { contextOf, industryOf, metricsTable, PLAN, ranked, titleOf, type FieldPick, type SuggestContext } from './suggest';
import type { Option, Suggestion } from './types';

/** Check ids the AI can suggest for; per-context checks are listed as `context.<kind>`. */
export const AI_CHECKS: ReadonlySet<string> = new Set(['project.description', 'core.business', 'core.industry', 'context.description', 'context.fact']);
const keyOf = (id: string) => (id.startsWith('context:') ? `context.${id.slice(id.indexOf('.') + 1)}` : id);
export const isAiCheck = (checkId: string): boolean => AI_CHECKS.has(keyOf(checkId));

const MAX_MARTS = 40;
const MAX_CANDIDATES = 20;
const TextSchema = z.object({ text: z.string().trim().min(1) });
const IndustrySchema = z.object({ industry: z.enum(INDUSTRIES.map((i) => i.id) as [string, ...string[]]) });
const PicksSchema = z.object({ picks: z.array(z.number().int()).max(4) });

/** The question shown under the check, before any AI call. */
export function aiQuestion(checkId: string, ctx: SuggestContext): string {
  const name = ctx.inputs.contexts.find((c) => c.id === contextOf(checkId))?.name ?? 'the context';
  switch (keyOf(checkId)) {
    case 'project.description': return 'What does the business sell, and to whom?';
    case 'core.business': return 'What does the business sell, to whom, and through which channels?';
    case 'core.industry': return 'Which business model is closest?';
    case 'context.description': return `What does ${name} own?`;
    case 'context.fact': return `Which number shows ${name} is doing its job?`;
    default: return '';
  }
}

const firstLine = (t: string | null) => (t ?? '').trim().split('\n')[0]!.trim();
const martList = (ctx: SuggestContext, ids?: string[]) =>
  ctx.inputs.marts.filter((m) => !ids || ids.includes(m.id)).slice(0, MAX_MARTS).map((m) => `- ${m.title}${firstLine(m.description) ? `: ${firstLine(m.description)}` : ''}`).join('\n') || '(none)';
const FORMAT = 'Answer in plain words, no Markdown. Use only the facts below. Never invent Data Marts.';

const one = (question: string, text: string, target: Suggestion['target']): Suggestion =>
  ({ question, options: [{ label: text, value: text, recommended: true }], ai: true, target });

async function ask<T extends z.ZodType>(generate: GenerateWith, prompt: string, schema: T): Promise<z.infer<T> | null> {
  try {
    const parsed = schema.safeParse(await generate(prompt, schema));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** An AI-drafted answer for a check, or null when the check isn't covered or the AI's answer is unusable. Never throws. */
export async function aiSuggestion(checkId: string, ctx: SuggestContext, generate: GenerateWith): Promise<Suggestion | null> {
  const question = aiQuestion(checkId, ctx);
  const desc = ctx.inputs.projectDescription?.trim() || '(empty)';
  switch (keyOf(checkId)) {
    case 'project.description': {
      const r = await ask(generate, `Write two sentences for a project description: what the business sells and to whom. ${FORMAT}\n\nDATA MARTS:\n${martList(ctx)}`, TextSchema);
      return r && one(question, r.text, (o) => ({ kind: 'description', mode: 'append', text: o.value as string }));
    }
    case 'core.business': {
      const core = ctx.settings.coreClasses?.map((c) => c.martId) ?? ranked(ctx).slice(0, industryOf(ctx).count);
      const titles = core.map((id) => titleOf(ctx, id)).join(', ') || '(none yet)';
      const r = await ask(generate, `Write one paragraph that says what the business sells, to whom and through which channels, naming these core Data Marts by title: ${titles}. ${FORMAT}\n\nPROJECT DESCRIPTION:\n${desc}\n\nDATA MARTS:\n${martList(ctx)}`, TextSchema);
      return r && one(question, r.text, (o) => ({ kind: 'description', mode: 'append', text: o.value as string }));
    }
    case 'core.industry': {
      const r = await ask(generate, `Pick the business model closest to this project. Allowed values: ${INDUSTRIES.map((i) => `${i.id} (${i.label})`).join(', ')}.\n\nPROJECT DESCRIPTION:\n${desc}\n\nDATA MARTS:\n${martList(ctx)}`, IndustrySchema);
      if (!r) return null;
      return {
        question, ai: true,
        options: INDUSTRIES.map((i): Option => ({ label: i.label, value: i.id, recommended: i.id === r.industry })),
        target: (o) => ({ kind: 'settings', patch: { industry: o.value as never } }),
      };
    }
    case 'context.description': {
      const c = ctx.inputs.contexts.find((x) => x.id === contextOf(checkId));
      if (!c) return null;
      const ids = ctx.inputs.marts.filter((m) => m.contexts.some((x) => x.id === c.id)).map((m) => m.id);
      const r = await ask(generate, `Write one or two sentences describing what the ${c.name} team or area owns, from its Data Marts. ${FORMAT}\n\nDATA MARTS IN ${c.name}:\n${martList(ctx, ids.length ? ids : undefined)}`, TextSchema);
      return r && one(question, r.text, (o) => ({ kind: 'context_update', id: c.id, name: c.name, description: o.value as string }));
    }
    case 'context.fact': {
      const c = ctx.inputs.contexts.find((x) => x.id === contextOf(checkId));
      if (!c) return null;
      const inCtx = new Set(ctx.inputs.marts.filter((m) => m.contexts.some((x) => x.id === c.id)).map((m) => m.id));
      const pool = ctx.nodes.filter((n) => inCtx.has(n.id));
      const cands: FieldPick[] = (pool.length ? pool : ctx.nodes).flatMap((n) => flattenFields(n.detail.fields)
        .filter(({ field }) => /NUMERIC|FLOAT|INT|DECIMAL|DOUBLE/.test(field.type.toUpperCase()) && !DATE_TYPES.has(field.type.toUpperCase()) && !PLAN.test(`${field.name} ${field.alias ?? ''}`))
        .map(({ path, field }) => ({ martId: n.id, title: n.title, field: path, label: `${field.alias || field.name} (${n.title})` }))).slice(0, MAX_CANDIDATES);
      if (!cands.length) return null;
      const r = await ask(generate, `Pick up to 4 numbers that best show the ${c.name} team is doing its job, best first. Answer with the indexes of the CANDIDATES.\n\nCANDIDATES:\n${cands.map((p, i) => `${i}: ${p.label}`).join('\n')}`, PicksSchema);
      const picks = [...new Set(r?.picks ?? [])].filter((i) => i >= 0 && i < cands.length).map((i) => cands[i]!);
      if (!picks.length) return null;
      return {
        question, ai: true,
        options: picks.map((p, i) => ({ label: p.label, value: p, recommended: i === 0 })),
        target: (o) => {
          const p = o.value as FieldPick;
          const metric = (p.label.split(' (')[0] ?? p.field).trim() || p.field;
          return { kind: 'context_update', id: c.id, name: c.name, description: upsertMetricsTable(c.description, metricsTable(ctx.projectId, metric, p)) };
        },
      };
    }
    default: return null;
  }
}
