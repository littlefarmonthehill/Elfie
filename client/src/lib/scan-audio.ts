// Audio cues for the warehouse filing scan panel. Lets a single filer work
// hands-free / eyes-free: a short tone confirms the outcome of each scan and an
// optional spoken phrase reads out where the lot should go. This mirrors
// "voice-directed putaway" used in distribution centres, scaled down to a phone
// + a wearable scanner.

export type ScanTone = "ok" | "new" | "warn" | "err";

// Distinct tone shapes per outcome so the filer can tell results apart without
// looking: a single bright note = filed correctly, two rising notes = override,
// a low two-note fall = wrong bin, a longer low buzz = error.
const TONES: Record<ScanTone, { freq: number[]; dur: number }> = {
  ok: { freq: [880], dur: 0.12 },
  new: { freq: [660, 990], dur: 0.12 },
  warn: { freq: [440, 330], dur: 0.18 },
  err: { freq: [220, 180], dur: 0.25 },
};

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

export function playTone(kind: ScanTone): void {
  const ac = getCtx();
  if (!ac) return;
  const { freq, dur } = TONES[kind];
  let t = ac.currentTime;
  for (const f of freq) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur;
  }
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

export function speak(text: string, rate = 0.82): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    // Cancel any in-flight phrase so the latest result wins instead of queueing.
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 1;
    synth.speak(u);
  } catch {
    // Speech is best-effort; the tone already conveys the outcome.
  }
}

// Speaks an intro phrase at normal conversational rate, then the bin name
// separately at a very slow, deliberate rate — mirroring voice-directed
// putaway where the picker hears the instruction first and then each segment
// of the bin address clearly. Hyphens in the bin name ("5-B-29") are
// replaced with comma-pauses so each section lands distinctly.
export function speakBin(intro: string, binName: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();

    // Intro at the regular conversational rate.
    const u1 = new SpeechSynthesisUtterance(intro);
    u1.rate = 0.82;
    u1.pitch = 1;

    // Bin name very slow: each dash-separated segment becomes its own breath.
    // "5-B-29" → "5, B, 29" reads as "five … B … twenty-nine".
    const binSpeech = binName.replace(/-/g, ", ");
    const u2 = new SpeechSynthesisUtterance(binSpeech);
    u2.rate = 0.38;
    u2.pitch = 1;

    // Chain via onend so the slow bin reads after the intro, not simultaneously.
    u1.onend = () => { try { synth.speak(u2); } catch {} };
    synth.speak(u1);
  } catch {
    // Speech is best-effort.
  }
}
