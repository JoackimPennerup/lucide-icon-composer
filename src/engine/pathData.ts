const arity: Record<string, number> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};
const numberPattern = /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/;

/** Expands SVG's compact arc flags for Paper.js without changing coordinates. */
export function normalizePathData(pathData: string): string {
  const output: string[] = [];
  let index = 0;
  let command = '';
  const skip = () => { while (index < pathData.length && /[\s,]/.test(pathData[index])) index++; };
  while (true) {
    skip();
    if (index >= pathData.length) break;
    const next = pathData[index];
    if (/[a-zA-Z]/.test(next)) {
      if (!(next.toLowerCase() in arity)) throw new Error(`Unsupported SVG path command: ${next}.`);
      command = next;
      index++;
      if (command.toLowerCase() === 'z') { output.push(command); command = ''; continue; }
    } else if (!command) {
      throw new Error('SVG path data needs a command.');
    }
    const values: string[] = [];
    for (let part = 0; part < arity[command.toLowerCase()]; part++) {
      skip();
      if (command.toLowerCase() === 'a' && (part === 3 || part === 4)) {
        const flag = pathData[index];
        if (flag !== '0' && flag !== '1') throw new Error('SVG arc flags must be 0 or 1.');
        values.push(flag);
        index++;
      } else {
        const match = numberPattern.exec(pathData.slice(index));
        if (!match) throw new Error(`Incomplete SVG ${command} path command.`);
        values.push(match[0]);
        index += match[0].length;
      }
    }
    output.push(`${command} ${values.join(' ')}`);
    if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
  }
  if (!output.length) throw new Error('SVG path data is empty.');
  return output.join(' ');
}
