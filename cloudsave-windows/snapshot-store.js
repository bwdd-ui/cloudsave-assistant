// Monitor snapshots are re-read at the start of the next run, so a half-written or unreadable
// file must degrade to "scan from scratch" instead of throwing inside run() and discarding the pass.
const EMPTY = { signature: '', rows: [], complete: false };

function readSnapshot(fs, file, onProblem) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { ...EMPTY };
    onProblem?.(`快照读取失败：${error.message}`);
    return { ...EMPTY };
  }
  try { return JSON.parse(raw); }
  catch (error) { onProblem?.(`快照内容无法解析，已按空快照重新扫描：${error.message}`); return { ...EMPTY }; }
}

// Same tmp+rename idiom the 观影 monitor already used by hand; a crash mid-write leaves the
// previous snapshot intact rather than truncating the only copy.
function writeSnapshot(fs, file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

module.exports = { EMPTY, readSnapshot, writeSnapshot };
