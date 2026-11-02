import * as lucide from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toLucideName } from './lucideName';

/** Every lucide icon by its kebab-case name. Pulls the whole library: only ever import it lazily. */
export const ICONS = new Map<string, LucideIcon>(Object.entries(lucide.icons).map(([name, icon]) => [toLucideName(name), icon as LucideIcon]));
