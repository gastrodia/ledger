/** Split PostgreSQL scripts while preserving quoted strings and dollar-quoted functions. */
export function splitSqlStatements(input: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let dollar: string | null = null;
  let lineComment = false;
  let blockDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockDepth) {
      if (input.slice(i, i + 2) === '/*') { blockDepth++; i++; }
      else if (input.slice(i, i + 2) === '*/') { blockDepth--; i++; }
      continue;
    }
    if (dollar) {
      if (input.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null; }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (input[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (input.slice(i, i + 2) === '--') { lineComment = true; i++; continue; }
    if (input.slice(i, i + 2) === '/*') { blockDepth = 1; i++; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '$') {
      const match = input.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollar = match[0]; i += dollar.length - 1; continue; }
    }
    if (char === ';') {
      const statement = input.slice(start, i).trim();
      if (statement) result.push(statement);
      start = i + 1;
    }
  }
  if (quote || dollar || blockDepth) throw new Error('SQL contains an unterminated quoted value or comment');
  const last = input.slice(start).trim();
  if (last) result.push(last);
  return result;
}
