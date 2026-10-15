// Portable storage selects userData first; keep the lock in the same scope as older versions.
// showErrorBox is supported before app.ready; do not initialize a second set of writers.
function acquireInstance(app, dialog, version) {
  const owned = !app.requestSingleInstanceLock || app.requestSingleInstanceLock({version});
  if (!owned && app.isPackaged) dialog.showErrorBox('云存助手已经在运行',
    '已有云存助手正在运行，本次程序未启动。\n\n您刚打开的版本是 ' + version + '。如需使用这个版本，请先在系统托盘右键云存助手，选择“退出程序”，再重新打开。关闭窗口默认只会隐藏到后台。\n\n已有监控任务不会被本次打开操作中断。');
  return owned;
}
module.exports = {acquireInstance};
