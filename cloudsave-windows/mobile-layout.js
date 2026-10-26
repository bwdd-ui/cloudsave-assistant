'use strict';
const DESKTOP = { width: 1440, height: 920, minWidth: 1100, minHeight: 700 };
const MIN_WIDTH = 320;
const MIN_HEIGHT = 480;

// A phone reaches this app through the container's virtual display, and Electron refuses to make a
// window narrower than minWidth. Keeping the desktop floor would stretch the 1100px layout across a
// portrait display, so the narrow-screen stylesheet would never activate.
function windowProfile({ displayWidth, displayHeight, force = false } = {}) {
  const width = Math.round(Number(displayWidth)) || 0;
  const height = Math.round(Number(displayHeight)) || 0;
  const mobile = force === true || (width > 0 && width < DESKTOP.minWidth);
  if (!mobile) return { mobile: false, fill: false, ...DESKTOP };
  return { mobile: true, fill: true, width: Math.max(MIN_WIDTH, width), height: Math.max(MIN_HEIGHT, height), minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT };
}

// Login and verification windows are sized for a desktop monitor; on the portrait phone display the
// same 1050x800 window would be drawn mostly outside the screen, so it has to shrink with the display.
function contentWindowSize({ mobile = false, width = 0, height = 0, displayWidth = 0, displayHeight = 0 } = {}) {
  if (!mobile || !(displayWidth > 0) || !(displayHeight > 0)) return { width, height };
  return { width: Math.max(MIN_WIDTH, Math.min(width, displayWidth)), height: Math.max(MIN_HEIGHT, Math.min(height, displayHeight)) };
}

module.exports = { windowProfile, contentWindowSize, DESKTOP, MIN_WIDTH, MIN_HEIGHT };
