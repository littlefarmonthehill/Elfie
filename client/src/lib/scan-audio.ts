// Audio cues for the warehouse filing scan panel. Lets a single filer work
// hands-free / eyes-free: distinct sci-fi tones convey the outcome of each
// scan, and an optional robot-voice phrase reads out where the lot goes.
// This mirrors "voice-directed putaway" used in distribution centres, scaled
// down to a phone + a wearable scanner.

export type ScanTone = "ok" | "new" | "warn" | "err";

let ctx: AudioContext | null = null;

// ── AudioContext keepalive ────────────────────────────────────────────────
// iOS/Safari suspends the AudioContext when no audio has been output for a
// few seconds, even if the page is still active.  Hardware scanner input
// (keyboard Enter key) is NOT counted as a user gesture, so ctx.resume()
// called just before scheduling notes often hasn't resolved yet and the
// notes are silently dropped.
//
// Fix: while the filing panel is mounted we ping the context every 4 s with
// a near-silent 1 ms oscillator burst — just enough to keep the state
// 'running' between scans.

let keepaliveHandle: ReturnType<typeof setInterval> | null = null;

function keepaliveTick(): void {
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
    return;
  }
  if (ctx.state !== 'running') return;
  try {
    const t = ctx.currentTime;
    const gn = ctx.createGain();
    // Gain so small it is acoustically inaudible on any device.
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.00001, t + 0.001);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(1, t); // 1 Hz — also inaudible
    osc.connect(gn).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.002);
  } catch { /* best-effort */ }
}

export function startAudioKeepalive(): void {
  stopAudioKeepalive();
  // Ensure context exists (creates it if first call, which is fine — this
  // runs after the user has already tapped the File tab).
  getCtx();
  keepaliveHandle = setInterval(keepaliveTick, 4_000);
}

export function stopAudioKeepalive(): void {
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
    // Browsers suspend the context until a user gesture; scans happen via a
    // tap / keypress / camera button so resuming here is safe.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
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

// Calm chime — plays when the filer is at a good pace.
// Quick ascending triangle triplet; pleasant, not jarring.
function playGoodPaceMelody(ac: AudioContext): void {
  let t = ac.currentTime + 0.01;
  t = note(ac, t, 523,  0.07, "triangle", 0.15); // C5
  t = note(ac, t, 659,  0.07, "triangle", 0.16); // E5
  note(ac, t,  784,  0.14, "triangle", 0.17);     // G5
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
  const ac = getCtx();

  const now = Date.now();
  // Trim timestamps older than 60 s so the array stays small.
  const cutoff = now - 60_000;
  while (recentFileTimes.length > 0 && recentFileTimes[0] < cutoff) recentFileTimes.shift();

  const gapMs = recentFileTimes.length > 0 ? now - recentFileTimes[recentFileTimes.length - 1] : null;
  recentFileTimes.push(now);

  const prevState = paceState;
  let melodyMs = 280; // ms to wait before speaking so voice trails the melody

  if (ac) {
    try {
      if (gapMs === null) {
        // First filing — welcome chime.
        paceState = 'unknown';
        playGoodPaceMelody(ac);
      } else {
        const nextState: PaceState = gapMs / 1000 > 14 ? 'slow' : 'good';
        paceState = nextState;
        if (nextState === 'slow') {
          playHurryMelody(ac);
          melodyMs = 800;
        } else if (prevState === 'slow') {
          playRecoveryMelody(ac);
          melodyMs = 440;
        } else {
          playGoodPaceMelody(ac);
        }
      }
    } catch {
      // Melody failed — fall back to the standard ok tone so filing isn't silent.
      try { playTone("ok"); } catch { /* best-effort */ }
      melodyMs = 160;
    }
  }

  // Speak the confirmation after the melody; call speak() directly so the
  // chirp + utterance are scheduled even if pace melodies aren't available.
  if (speech) setTimeout(() => speak(speech), melodyMs);
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
