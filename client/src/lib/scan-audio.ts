// Audio cues for the warehouse filing scan panel. Lets a single filer work
// hands-free / eyes-free: distinct sci-fi tones convey the outcome of each
// scan, and an optional robot-voice phrase reads out where the lot goes.
// This mirrors "voice-directed putaway" used in distribution centres, scaled
// down to a phone + a wearable scanner.

export type ScanTone = "ok" | "new" | "warn" | "err";

let ctx: AudioContext | null = null;

// ── AudioContext keepalive ────────────────────────────────────────────────
// iOS/Safari aggressively suspends the AudioContext when no audio has been
// produced for a few seconds, even while the page is active.  Hardware
// scanner input (Enter key from a barcode gun) is NOT a user gesture, so
// calling ctx.resume() just before scheduling notes is async — notes get
// scheduled on a still-suspended context and are silently dropped.
//
// Previous approach: poll with setInterval + one-shot silent bursts.
// Problem: two races — (a) the burst fires AFTER resume() but the context
//   re-suspends before the next tick, and (b) if suspended at tick time,
//   resume() is called but returns immediately before actually running, so
//   the silent burst path is skipped.
//
// Real fix: a continuously-running oscillator at acoustically-inaudible
// gain (0.00001 ≈ -100 dB).  While a node is actively outputting audio the
// browser cannot suspend the context, so the AC stays in 'running' state
// between scans no matter how long the filer pauses.

let silenceOsc: OscillatorNode | null = null;
let silenceGain: GainNode | null = null;
let keepaliveHandle: ReturnType<typeof setInterval> | null = null; // kept for cleanup compat

function attachSilenceGenerator(ac: AudioContext): void {
  if (silenceOsc) return; // already attached
  try {
    silenceGain = ac.createGain();
    silenceGain.gain.setValueAtTime(0.00001, ac.currentTime); // ~−100 dB — inaudible
    silenceGain.connect(ac.destination);
    silenceOsc = ac.createOscillator();
    silenceOsc.frequency.setValueAtTime(1, ac.currentTime); // 1 Hz — subsonic
    silenceOsc.connect(silenceGain);
    silenceOsc.start();
    // No .stop() — runs until detachSilenceGenerator() or page unload.
  } catch { /* best-effort */ }
}

function detachSilenceGenerator(): void {
  try { silenceOsc?.stop(); } catch {}
  try { silenceOsc?.disconnect(); } catch {}
  try { silenceGain?.disconnect(); } catch {}
  silenceOsc = null;
  silenceGain = null;
}

export function startAudioKeepalive(): void {
  stopAudioKeepalive();
  // Create context now (within or just after a user gesture from the tab tap).
  const ac = getCtx();
  if (ac) attachSilenceGenerator(ac);
}

export function stopAudioKeepalive(): void {
  detachSilenceGenerator();
  if (keepaliveHandle !== null) {
    clearInterval(keepaliveHandle);
    keepaliveHandle = null;
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// Returns a Promise that resolves to a running AudioContext, or null if
// unavailable.  Awaiting this before scheduling notes guarantees the context
// is actually running — critical for melody functions called from non-gesture
// event paths (scanner input, timers).
function getRunningCtx(): Promise<AudioContext | null> {
  const ac = getCtx();
  if (!ac) return Promise.resolve(null);
  if (ac.state === 'running') return Promise.resolve(ac);
  return ac.resume().then(() => ac).catch(() => null);
}

// Play a single note at `freq` Hz for `dur` seconds starting at time `t`.
// Returns the time at which the note ends.
function note(
  ac: AudioContext,
  t: number,
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  peakGain = 0.18,
): number {
  const osc = ac.createOscillator();
  const gn = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(peakGain, t + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gn).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.01);
  return t + dur;
}

// Play a frequency sweep from `f0` to `f1` over `dur` seconds.
// Returns the time at which the sweep ends.
function sweep(
  ac: AudioContext,
  t: number,
  f0: number,
  f1: number,
  dur: number,
  type: OscillatorType = "sawtooth",
  peakGain = 0.15,
): number {
  const osc = ac.createOscillator();
  const gn = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f1, t + dur);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(peakGain, t + 0.010);
  gn.gain.setValueAtTime(peakGain, t + dur - 0.04);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gn).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return t + dur;
}

export function playTone(kind: ScanTone): void {
  const ac = getCtx();
  if (!ac) return;
  let t = ac.currentTime;

  switch (kind) {
    case "ok": {
      // Correct bin — Jetsons-style sci-fi success: bright 4-note ascending
      // square-wave arpeggio (classic electronic "blip blip blip DING").
      t = note(ac, t, 523, 0.06, "square", 0.16);  // C5
      t = note(ac, t, 659, 0.06, "square", 0.17);  // E5
      t = note(ac, t, 784, 0.06, "square", 0.18);  // G5
      note(ac, t, 1047, 0.16, "square", 0.20);     // C6 — final ring
      break;
    }
    case "new": {
      // Override / new bin — sci-fi power-up: softer triangle arpeggio,
      // slightly higher top note to sound distinct from "ok".
      t = note(ac, t, 659, 0.07, "triangle", 0.18); // E5
      t = note(ac, t, 880, 0.07, "triangle", 0.19); // A5
      note(ac, t, 1319, 0.15, "triangle", 0.21);    // E6 — "levelled up"
      break;
    }
    case "warn": {
      // Wrong bin — Jetsons-style descending sawtooth alarm: two downward
      // sweeps that sound like a classic sci-fi "danger" klaxon.
      t = sweep(ac, t, 580, 230, 0.22, "sawtooth", 0.15);
      t += 0.04; // brief gap between the two alarm pulses
      sweep(ac, t, 580, 230, 0.22, "sawtooth", 0.15);
      break;
    }
    case "err": {
      // System error — single deep descending sawtooth buzz; ominous and
      // clearly different from the warning alarm.
      sweep(ac, t, 360, 90, 0.40, "sawtooth", 0.14);
      break;
    }
  }
}

// Brief two-blip robot "transmission start" chirp played before the voice
// so speech feels like a robot radio call rather than plain TTS.
function playRobotChirp(ac: AudioContext): void {
  let t = ac.currentTime;
  t = note(ac, t, 880, 0.045, "square", 0.12);
  note(ac, t, 1320, 0.055, "square", 0.13);
}

// Call from a user gesture (opening the camera, toggling sound) to satisfy
// browser autoplay rules so the first scan after that isn't silent.
export function unlockAudio(): void {
  getCtx();
  try {
    window.speechSynthesis?.resume();
  } catch {
    // best-effort
  }
}

// ── Pace-aware filing melodies ────────────────────────────────────────────

// Timestamps of the last few successful lot-filed events.
const recentFileTimes: number[] = [];
type PaceState = 'unknown' | 'good' | 'slow';
let paceState: PaceState = 'unknown';

// 8-bit boot-up jingle: rising power-on sweep then a bright 4-note arpeggio.
// Played when the filing panel first mounts so the filer knows the session is live.
function playStartupMelody(ac: AudioContext): void {
  let t = ac.currentTime + 0.12; // let the tab transition settle first
  // Rising sawtooth sweep — "powering up"
  t = sweep(ac, t, 110, 440, 0.28, 'sawtooth', 0.11);
  t += 0.05;
  // Ascending major arpeggio — "ready!"
  t = note(ac, t, 523,  0.08, 'square',   0.16); // C5
  t = note(ac, t, 659,  0.08, 'square',   0.17); // E5
  t = note(ac, t, 784,  0.08, 'square',   0.18); // G5
  note(ac,  t, 1047, 0.28, 'triangle', 0.15);     // C6 — bell ring
}

/**
 * Play the filing-session startup melody and reset pace tracking so every
 * new session begins with a clean slate (no carry-over from a prior session).
 */
export function playFilingStartup(): void {
  // Reset pace state so each new session starts fresh.
  recentFileTimes.length = 0;
  paceState = 'unknown';
  const ac = getCtx();
  if (!ac) return;
  try { playStartupMelody(ac); } catch { /* best-effort */ }
}

// Mario-style "hurry up" nudge — plays when the filer has gone slow (gap > 14 s).
// Classic SMB main-theme opening, fast square-wave, ~0.8 s total.
function playHurryMelody(ac: AudioContext): void {
  let t = ac.currentTime + 0.01;
  const q = 0.09;
  t = note(ac, t, 659, q,       "square", 0.18); // E5
  t += q * 0.55;
  t = note(ac, t, 659, q,       "square", 0.18); // E5
  t += q * 0.55;
  t = note(ac, t, 659, q,       "square", 0.18); // E5
  t += q * 0.45;
  t = note(ac, t, 523, q * 0.7, "square", 0.15); // C5
  t = note(ac, t, 659, q,       "square", 0.18); // E5
  t = note(ac, t, 784, q * 1.9, "square", 0.20); // G5 (held)
  note(ac, t,       392, q * 2.4, "square", 0.13); // G4 (low, bass undertone)
}

// Good-pace chime — ascending 3-note arpeggio, square wave to match the
// volume and character of the ok/err tones that the filer already knows.
function playGoodPaceMelody(ac: AudioContext): void {
  let t = ac.currentTime + 0.01;
  t = note(ac, t, 523,  0.07, "square", 0.17); // C5
  t = note(ac, t, 659,  0.07, "square", 0.18); // E5
  note(ac, t,  784,  0.18, "square", 0.19);     // G5 — held slightly longer
}

// Recovery fanfare — first good file after a slow streak.
// Short ascending arpeggio to celebrate getting back on pace.
function playRecoveryMelody(ac: AudioContext): void {
  let t = ac.currentTime + 0.01;
  t = note(ac, t, 523,  0.07, "square", 0.16); // C5
  t = note(ac, t, 659,  0.07, "square", 0.17); // E5
  t = note(ac, t, 784,  0.07, "square", 0.18); // G5
  note(ac, t,  1047, 0.22, "square", 0.20);     // C6 — ring out
}

/**
 * Call on every successful lot-filed event.
 * Tracks pace and plays the appropriate melody, then speaks the confirmation.
 * Falls back to the standard ok tone if the melody fails so filing is never silent.
 *   - First file or good pace: calm 3-note chime
 *   - Slow pace (> 14 s gap): Mario hurry melody
 *   - Recovery (first good file after a slow stint): ascending fanfare
 */
export function reportFilingSuccess(speech?: string): void {
  // Pace tracking is synchronous — do it immediately so timestamps are exact.
  const now = Date.now();
  const cutoff = now - 60_000;
  while (recentFileTimes.length > 0 && recentFileTimes[0] < cutoff) recentFileTimes.shift();
  const gapMs = recentFileTimes.length > 0 ? now - recentFileTimes[recentFileTimes.length - 1] : null;
  recentFileTimes.push(now);

  const prevState = paceState;

  // Determine which melody to play and how long before we should speak.
  // We compute this now so the speak() timer fires at the right offset even
  // though melody scheduling is async.
  let melodyMs = 280;
  let chosenMelody: 'good' | 'hurry' | 'recovery' = 'good';
  if (gapMs === null) {
    paceState = 'unknown';
    chosenMelody = 'good';
    melodyMs = 280;
  } else {
    const nextState: PaceState = gapMs / 1000 > 14 ? 'slow' : 'good';
    paceState = nextState;
    if (nextState === 'slow') {
      chosenMelody = 'hurry';
      melodyMs = 800;
    } else if (prevState === 'slow') {
      chosenMelody = 'recovery';
      melodyMs = 440;
    } else {
      chosenMelody = 'good';
      melodyMs = 280;
    }
  }

  // Schedule the speak timer.
  if (speech) setTimeout(() => speak(speech), melodyMs);

  // Use getCtx() synchronously — the same path used by playTone(), speak(),
  // and playFilingStartup(), all of which work reliably.  The silence
  // generator keeps the context running between scans, so this is safe.
  const ac = getCtx();
  if (!ac) return;
  try {
    if (chosenMelody === 'hurry') playHurryMelody(ac);
    else if (chosenMelody === 'recovery') playRecoveryMelody(ac);
    else playGoodPaceMelody(ac);
  } catch {
    try { playTone("ok"); } catch { /* best-effort */ }
  }
}

// Pending speech timer — cancelled if a new speak() fires before it triggers
// so rapid successive cues don't queue up stale phrases.
let pendingSpeakTimer: ReturnType<typeof setTimeout> | null = null;

export function speak(text: string, rate = 1.1): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;

    // Cancel any currently speaking phrase and any queued one.
    synth.cancel();
    if (pendingSpeakTimer !== null) {
      clearTimeout(pendingSpeakTimer);
      pendingSpeakTimer = null;
    }

    // Play the robot chirp, then let it finish before the voice starts so
    // the two don't collide (chirp is 2 × ~50 ms = ~100 ms total).
    const ac = getCtx();
    if (ac) playRobotChirp(ac);

    pendingSpeakTimer = setTimeout(() => {
      pendingSpeakTimer = null;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 1.5;  // higher pitch — classic friendly-robot register
      u.rate = rate;
      synth.speak(u);
    }, 120);
  } catch {
    // Speech is best-effort; the tone already conveys the outcome.
  }
}

// Speaks a bin name slowly and deliberately. Hyphens are converted to
// comma-pauses so "5-B-29" is heard as "5 … B … 29" with clear gaps
// between each segment. No intro phrase — just the address.
export function speakBin(binName: string): void {
  const binSpeech = binName.replace(/-/g, ", ");
  speak(binSpeech, 1.15);
}
