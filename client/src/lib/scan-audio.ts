// Audio cues for the warehouse filing scan panel. Lets a single filer work
// hands-free / eyes-free: distinct sci-fi tones convey the outcome of each
// scan, and an optional robot-voice phrase reads out where the lot goes.
// This mirrors "voice-directed putaway" used in distribution centres, scaled
// down to a phone + a wearable scanner.

export type ScanTone = "ok" | "new" | "warn" | "err";

let ctx: AudioContext | null = null;

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

// Pending speech timer — cancelled if a new speak() fires before it triggers
// so rapid successive cues don't queue up stale phrases.
let pendingSpeakTimer: ReturnType<typeof setTimeout> | null = null;

export function speak(text: string, rate = 0.75): void {
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
      u.rate = rate;  // deliberate, slightly slower cadence
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
  speak(binSpeech, 0.65);
}
