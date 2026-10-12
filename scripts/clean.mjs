/**
 * Removes the build output directory (dist/).
 * No external dependency is used on purpose - only Node.js built-ins.
 */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distPath = join(projectRoot, 'dist');

rmSync(distPath, { recursive: true, force: true });
console.log(`[clean] removed ${distPath}`);
