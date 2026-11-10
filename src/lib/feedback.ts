import type { Settings } from '../types';

let audioCtx: AudioContext | null = null;

function beep() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx ?? new AC();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 1040;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.09);
  } catch {
    /* audio not available */
  }
}

export function feedback(s: Pick<Settings, 'beep' | 'vibrate'>) {
  if (s.beep) beep();
  if (s.vibrate && 'vibrate' in navigator) {
    try {
      navigator.vibrate(40);
    } catch {
      /* ignore */
    }
  }
}
