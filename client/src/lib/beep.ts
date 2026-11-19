let ctx: AudioContext | null = null;

/** Short beep for a successful barcode scan (or a lower one for "not found"). */
export function beep(ok = true): void {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1500 : 300;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
  } catch {
    // No audio device: scanning still works.
  }
}
