import type { ClassNode } from '../types';
import type { MartInfo } from './Card';
import { MartIcon } from './MartIcon';

/** A class as a name and its icon only; the goal is larger and outlined in blue. */
export function OntologyCard({ cls, mart, goal }: { cls: ClassNode; mart?: MartInfo; goal: boolean }) {
  return (
    <div className="gy-ocard" data-class-id={cls.id} data-goal={String(goal)}>
      <span className="gy-logo"><MartIcon icon={mart?.icon} size={goal ? 28 : 22} /></span>
      <span className="gy-ocard-title">{cls.title}</span>
    </div>
  );
}
