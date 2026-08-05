import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkEntry = fileURLToPath(import.meta.resolve('@owox/plugin-sdk'));
const collectionsModule = join(dirname(sdkEntry), 'collections.js');

if (!existsSync(collectionsModule)) {
  throw new Error(
    [
      'The installed @owox/plugin-sdk does not contain ctx.collections().',
      'Install the fixed-group ODM release that includes task 6788, refresh package-lock.json,',
      'and run the build again.',
    ].join(' '),
  );
}
