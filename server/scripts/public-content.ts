/** Remove explicitly marked development-only notes from release text. */
export function publicContent(source: string): string {
  const output: string[] = [];
  let privateSection = false;
  for (const line of source.split('\n')) {
    const marker = /^(?:<!--|\/\/|#) private:(start|end)(?: -->)?$/u.exec(
      line.trim(),
    );
    if (marker !== null) {
      const start = marker[1] === 'start';
      if (start === privateSection)
        throw new Error('Unbalanced private release section');
      privateSection = start;
    } else if (!privateSection) output.push(line);
  }
  if (privateSection) throw new Error('Unclosed private release section');
  return output.join('\n').replace(/\n{3,}/gu, '\n\n');
}
