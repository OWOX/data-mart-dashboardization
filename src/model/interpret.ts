import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { MartLink } from '../lib/links';
import { normalizeCurrency } from '../lib/format';

const FORMAT = z.enum(['number', 'percent', 'currency']);
const AGG = z.enum(['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX']);

export const AiOutputSchema = z.object({
  goal: z.object({
    status: z.enum(['ok', 'missing', 'placeholder']),
    metricRef: z.string().nullable(),
    note: z.string(),
  }),
  metrics: z.array(z.object({
    ref: z.string(),
    role: z.enum(['critical', 'leading', 'lagging']),
    source: z.string(),
    alias: z.string(),
    factLink: z.number().int().nullable(),
    planLink: z.number().int().nullable(),
    kind: z.enum(['flow', 'level']),
    planShape: z.enum(['daily', 'cumulative', 'level']).nullable(),
    factDateField: z.string().nullable(),
    planDateField: z.string().nullable(),
    aggregation: AGG.nullable(),
    format: FORMAT.catch('number'),
    currency: z.string().nullable().catch(null),
  })),
});

export type AiOutput = z.infer<typeof AiOutputSchema>;
export type AiMetric = AiOutput['metrics'][number];

export interface InterpretInput {
  projectDescription: string | null;
  contexts: { id: string; name: string; description: string | null }[];
  links: MartLink[];
  dateFields: Record<string, string[]>;
}

export type Generate = (prompt: string) => Promise<unknown>;

const RULES = [
  'RULES:',
  '1. The goal is the "Critical number" row in the PROJECT DESCRIPTION\'s metrics table. If there is no such row, goal.status is "missing". If its fact link is a PLACEHOLDER link or is absent, goal.status is "placeholder".',
  '2. One metric per metrics-table row in the project and in each context. source is "project" or the context id. alias is the metric name in the row without units, for example "ARR" for "ARR, $".',
  '3. factLink and planLink are link indexes from LINKS, or null.',
  '4. kind is "level" when the text says the value is a snapshot or must not be summed across days, else "flow".',
  '5. planShape is "cumulative" when plan values accumulate from a period start, "level" when the plan is a per-day level, else "daily". Null without a plan link.',
  '6. factDateField and planDateField come only from DATE FIELDS for that link\'s mart. Prefer a field the text names as the date field for the period.',
  '7. aggregation is null unless the text says how to aggregate.',
  '8. format is "percent" for rates, shares and ratios stored as fractions (0.04 = 4%), "currency" for money, otherwise "number". currency is the ISO 4217 code when the description or the field names one, else null.',
  '9. ref values are "m1", "m2", ... in reading order. goal.metricRef is the goal row\'s ref.',
].join('\n');

export function buildPrompt(input: InterpretInput): string {
  const parts = [
    'You read an OWOX project\'s descriptions and list the metrics they define. Answer only from the text and the numbered links below. Never invent links or fields.',
    `PROJECT DESCRIPTION:\n${input.projectDescription || '(empty)'}`,
    ...input.contexts.filter((c) => c.description !== null).map((c) => `CONTEXT ${c.id} (${c.name}):\n${c.description}`),
    `LINKS:\n${input.links.map((l) => `${l.index}: [${l.text}] mart=${l.martId ?? 'PLACEHOLDER'} field=${l.field ?? 'none'} source=${l.source}`).join('\n')}`,
    `DATE FIELDS:\n${Object.entries(input.dateFields).map(([id, f]) => `${id}: ${f.join(', ')}`).join('\n')}`,
    RULES,
  ];
  return parts.join('\n\n');
}

export async function interpret(generate: Generate, input: InterpretInput): Promise<AiOutput> {
  const raw = await generate(buildPrompt(input));
  const parsed = AiOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error('AI_INVALID: ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
  return { ...parsed.data, metrics: parsed.data.metrics.map((m) => ({ ...m, currency: m.format === 'currency' ? normalizeCurrency(m.currency) : null })) };
}

export function aiGenerate(model: unknown, signal?: AbortSignal): Generate {
  return async (prompt) => {
    const { output } = await generateText({
      model: model as never, // the SDK's provider-v4 handle; ai@7 accepts LanguageModelV4
      output: Output.object({ schema: AiOutputSchema }),
      prompt,
      temperature: 0,
      abortSignal: signal,
    });
    return output;
  };
}
