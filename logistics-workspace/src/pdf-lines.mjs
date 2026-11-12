export function linesFromItems(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const [, , , , x, y] = item.transform;
    let row = rows.find(row => Math.abs(row.y - y) < 1.5);
    if (!row) { row = {y, items: []}; rows.push(row); }
    row.items.push({x, width: item.width, text: item.str});
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    let line = '';
    let end = -Infinity;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const gap = item.x - end;
      const separator = !line || /\s$/.test(line) ? '' : gap > 16 ? '    ' : gap > 1 ? ' ' : '';
      line += separator + item.text;
      end = item.x + item.width;
    }
    return line;
  }).join('\n');
}

