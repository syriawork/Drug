/**
 * Shared settings-field classification guard for Stage 12 and Stage 13
 * architecture tests.
 *
 * The renderer may only use stored settings values for presentation: showing
 * them on screen. Any other use - assigning to a variable, returning, throwing,
 * comparing, using in a condition, or calculating with them - lets the renderer
 * make decisions from stored data, which violates the read-only boundary.
 *
 * A usage that cannot be classified safely is treated as unsafe (conservative).
 */

export type SettingUsageVerdict = 'presentational' | 'unsafe';

export function classifySettingFieldUsage(
  line: string,
  field: string,
): SettingUsageVerdict {
  const memberAccess = `settings.${field}`;
  // 1. UNSAFE: assigning TO a setting field (settings.field = ...)
  if (new RegExp(`\\.${field}\\s*(=|\\+=|-=|\\*=|/=|\\+\\+|--)`).test(line)) {
    return 'unsafe';
  }

  // 2. UNSAFE: assigning a setting value to another variable
  const varAssignment = new RegExp(
    `(?:const|let|var)\s+[\w$]+\s*=\s*[\w$.]*\.${field}\b`,
  );
  if (varAssignment.test(line)) {
    return 'unsafe';
  }

  const plainAssignment = new RegExp(
    `(?<!\.)[\w$]+\s*=\s*[\w$.]*\.${field}\b`,
  );
  if (
    plainAssignment.test(line) &&
    !new RegExp(`\\.value\\s*=\\s*[\\w$.]*\\.${field}`).test(line)
  ) {
    return 'unsafe';
  }

  // 3. UNSAFE: returning or throwing a setting value
  if (
    new RegExp(`\\breturn\\s+[\\w$.]*\\.${field}\\b`).test(line) ||
    new RegExp(`\\bthrow\\s+[\\w$.]*\\.${field}\\b`).test(line)
  ) {
    return 'unsafe';
  }

  // 4. UNSAFE: comparison operators involving the setting value
  const comparisonOps = ['===', '!==', '>=', '<=', '>', '<', '==', '!='];
  for (const op of comparisonOps) {
    if (
      line.includes(`${memberAccess} ${op}`) ||
      line.includes(`${op} ${memberAccess}`)
    ) {
      return 'unsafe';
    }
  }

  // 5. UNSAFE: the setting value used in an if condition
  if (new RegExp(`\\bif\\s*\\([^)]*[\\w$.]*\\.${field}`).test(line)) {
    return 'unsafe';
  }
  // 6. PRESENTATIONAL: String(settings.field)
  if (new RegExp(`String\\(\\s*[\\w$.]*\\.${field}\\s*\\)`).test(line)) {
    return 'presentational';
  }

  // 7. PRESENTATIONAL: booleanLabel(settings.field)
  if (
    new RegExp(`booleanLabel\\(\\s*[\\w$.]*\\.${field}\\s*\\)`).test(line)
  ) {
    return 'presentational';
  }

  // 8. PRESENTATIONAL: setText(..., settings.field)
  if (
    line.includes('setText(') &&
    new RegExp(`[\\w$.]*\\.${field}\\b`).test(line)
  ) {
    return 'presentational';
  }

  // 9. PRESENTATIONAL: setHidden(..., settings.field) or setDisabled(...)
  if (
    (line.includes('setHidden(') || line.includes('setDisabled(')) &&
    new RegExp(`[\\w$.]*\\.${field}\\b`).test(line)
  ) {
    return 'presentational';
  }

  // 10. PRESENTATIONAL: .value = settings.field or .value = String(...)
  if (
    new RegExp(`\\.value\\s*=\\s*(String\\(\\s*)?[\\w$.]*\\.${field}`).test(
      line,
    )
  ) {
    return 'presentational';
  }

  // 11. Unclassifiable -> reject (conservative)
  return 'unsafe';
}
function lineContaining(code: string, index: number): string {
  const lineStart = code.lastIndexOf('\n', index);
  const lineEnd = code.indexOf('\n', index);
  const start = lineStart === -1 ? 0 : lineStart + 1;
  const end = lineEnd === -1 ? code.length : lineEnd;
  return code.slice(start, end);
}

export function assertSettingsFieldsAreOnlyRendered(
  code: string,
  fields: readonly string[],
  sourceLabel: string,
): void {
  for (const field of fields) {
    const memberAccess = `settings.${field}`;
    let searchFrom = 0;

    while (true) {
      const occurrence = code.indexOf(memberAccess, searchFrom);
      if (occurrence === -1) {
        break;
      }

      const line = lineContaining(code, occurrence);
      const verdict = classifySettingFieldUsage(line, field);

      if (verdict === 'unsafe') {
        throw new Error(
          `unsafe use of settings.${field} in ${sourceLabel}: ${line.trim()}`,
        );
      }

      searchFrom = occurrence + memberAccess.length;
    }
  }
}
