import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import type { CollectionsLike } from '../store/collections';
import type { Model } from '../types';
import { WARM_ACTION, parseWarmInput } from './input';
import { writeSnapshot } from './snapshot';

/** The member's own schedules: OWOX lists every schedule of the installation, so the member id in the parameters tells them apart. */
export const ownSchedules = (all: readonly PluginSchedule[], memberId: string): PluginSchedule[] =>
  all.filter((s) => s.action === WARM_ACTION && parseWarmInput(s.parameters)?.memberId === memberId);

/** After an ontology save: the snapshot follows the new model, and each own schedule names its Data Marts. */
export async function syncSchedules(args: { schedules: PluginSchedules; store: CollectionsLike; model: Model; memberId: string }): Promise<void> {
  const { schedules, store, model, memberId } = args;
  const mine = ownSchedules(await schedules.list(), memberId);
  if (!mine.length) return;
  const martIds = await writeSnapshot(store, model, memberId);
  for (const s of mine) {
    const input = parseWarmInput(s.parameters)!;
    if (input.martIds.join() === martIds.join()) continue;
    await schedules.update(s.id, { parameters: { ...input, martIds } });
  }
}
