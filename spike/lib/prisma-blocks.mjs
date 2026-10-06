// A deliberately small, line-oriented reader for `prisma format`-ted schema text.
//
// It is NOT a Prisma parser. It relies on two properties that `prisma format`
// guarantees and that every fragment must keep (the composer rejects a file
// that breaks them):
//   1. a block header is `<kind> <Name> {` on ONE line, at column 0;
//   2. a block ends with `}` alone on a line, at column 0.
// Comments and blank lines between blocks are kept as the NEXT block's
// "leading" text, so a banner or a doc comment travels with its model.

const HEADER = /^(?:(extend)\s+)?(model|enum|type|view|generator|datasource)\s+([A-Za-z_]\w*)\s*\{\s*$/;

/** @returns {{blocks: Block[], trailing: string}} */
export function parseBlocks(src, file = '<memory>') {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let acc = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (!cur) {
      const m = HEADER.exec(line);
      if (m) {
        cur = { extend: m[1] === 'extend', kind: m[2], name: m[3], leading: acc.join('\n'), lines: [line], file, line: i + 1 };
        acc = [];
      } else if (/^\s*(model|enum|type|view|generator|datasource|extend)\b.*\{/.test(line)) {
        throw new Error(`${file}:${i + 1}: block header must be "<kind> <Name> {" on one line at column 0: ${line}`);
      } else {
        acc.push(line);
      }
    } else {
      cur.lines.push(line);
      if (line === '}') {
        blocks.push(cur);
        cur = null;
      }
    }
  });
  if (cur) throw new Error(`${file}:${cur.line}: block "${cur.name}" is not closed by "}" at column 0`);
  return { blocks, trailing: acc.join('\n') };
}

/** Is the block marked `// @extensible` in the comment run directly above it? */
export function isExtensible(block) {
  const above = block.leading.split('\n');
  for (let i = above.length - 1; i >= 0; i--) {
    if (above[i].trim() === '') break;
    if (/^\s*\/\/\s*@extensible\b/.test(above[i])) return true;
  }
  return false;
}

const FIELD = /^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?(\s.*)?$/;

/**
 * Field/attribute view of a model or enum body. Each entry carries the comment
 * lines directly above it so they can be moved together.
 * @returns {{fields: Field[], attrs: Field[], tail: string[]}}
 */
export function parseBody(block) {
  const body = block.lines.slice(1, -1);
  const fields = [];
  const attrs = [];
  let pending = [];
  for (const raw of body) {
    const t = raw.trim();
    if (t === '' ) { pending.push(raw); continue; }
    if (t.startsWith('//')) { pending.push(raw); continue; }
    if (t.startsWith('@@')) { attrs.push({ raw, leading: pending }); pending = []; continue; }
    const m = FIELD.exec(raw);
    if (!m) throw new Error(`${block.file}:${block.line}: cannot read field line in ${block.name}: ${raw}`);
    fields.push({ name: m[1], type: m[2], list: !!m[3], optional: !!m[4], attrs: m[5] ?? '', raw, leading: pending });
    pending = [];
  }
  return { fields, attrs, tail: pending };
}

export function renderBlock(block) {
  return `${block.leading ? block.leading + '\n' : ''}${block.lines.join('\n')}`;
}
