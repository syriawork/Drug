/**
 * Copies the static renderer assets (HTML/CSS) into dist/renderer so that the
 * compiled renderer script, the markup and the stylesheet live side by side.
 * No external dependency is used on purpose - only Node.js built-ins.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(projectRoot, 'src', 'renderer');
const targetDir = join(projectRoot, 'dist', 'renderer');

/** Static assets that must be shipped next to the compiled renderer script. */
const staticFiles = ['index.html', 'styles.css'];

mkdirSync(targetDir, { recursive: true });

function copyWithRetry(sourcePath, targetPath, retries = 5, delayMs = 150) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      copyFileSync(sourcePath, targetPath);
      return;
    } catch (err) {
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM') && attempt < retries) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        continue;
      }
      throw err;
    }
  }
}

for (const fileName of staticFiles) {
  const sourcePath = join(sourceDir, fileName);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    console.error(`[copy-static] MISSING required asset: ${sourcePath}`);
    process.exit(1);
  }
  const targetPath = join(targetDir, fileName);
  copyWithRetry(sourcePath, targetPath);
  console.log(`[copy-static] ${fileName} -> dist/renderer/${fileName}`);
}