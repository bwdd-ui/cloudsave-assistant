const QUIT_WAIT_DEADLINE_MS = 20000;
function pendingQuitTasks(tasks) { return tasks.filter(([, busy]) => busy()).map(([name]) => name); }
async function waitForQuitIdle(tasks, { wait, deadlineMs = QUIT_WAIT_DEADLINE_MS, now = Date.now } = {}) {
  const deadline = now() + deadlineMs;
  for (;;) {
    const pending = pendingQuitTasks(tasks);
    if (!pending.length) return { pending, timedOut: false };
    if (now() >= deadline) return { pending, timedOut: true };
    await wait(25);
  }
}
module.exports = { QUIT_WAIT_DEADLINE_MS, pendingQuitTasks, waitForQuitIdle };
