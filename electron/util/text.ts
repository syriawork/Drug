/**
 * Framework-free, dependency-free helpers for Arabic text handling.
 * Kept free of Electron imports so it can be unit tested directly.
 */

/** Arabic Unicode blocks: Arabic (0600-06FF) and Arabic Supplement (0750-077F). */
const ARABIC_RANGES: readonly (readonly [number, number])[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
];

/** Returns true when the given text contains at least one Arabic character. */
export function containsArabicCharacters(text: string): boolean {
  return countArabicCharacters(text) > 0;
}

/** Counts the Arabic characters contained in the given text. */
export function countArabicCharacters(text: string): number {
  let count = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    for (const [start, end] of ARABIC_RANGES) {
      if (codePoint >= start && codePoint <= end) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** Returns the code points of a string (helps asserting non-Latin rendering in logs). */
export function toCodePoints(text: string): readonly number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}
