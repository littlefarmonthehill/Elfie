---
name: Scan panel audio cues
description: Hands-free audio feedback in WarehouseScanPanel and the camera re-fire gotcha
---

Audio cues (beep tone + optional SpeechSynthesis) give one filer voice-directed putaway in the warehouse filing panel. Tones/speech live in `client/src/lib/scan-audio.ts`; `cue(kind, speech?)` in the panel fires on each scan outcome.

**Camera re-fire gotcha.** The BarcodeDetector `scanFrame` loop detects the SAME visible QR on every animation frame. Once `processingRef` clears, the same code re-triggers `processCode` → duplicate feed entries + repeated speech/tone bursts.
**Why a timer cooldown is wrong:** the wrong-bin flow requires scanning the same bin twice to confirm an override. A time-based dedupe would let the camera auto-confirm an override just by lingering on a bin. 
**How to apply:** dedupe by *code identity reset on absence* — track `lastCameraCodeRef`; skip if the detected code equals it, and clear it to null when no code is in view. The user must move the camera away and back to re-scan the same code, which is the deliberate action needed for override confirmation.

**Stale-closure rule:** `cue()` reads `soundOnRef.current` (a ref synced from `soundOn` state via effect), NOT the `soundOn` state value, because the long-lived camera scan loop captures an old closure of `processCode`.

**Autoplay unlock:** browsers gate AudioContext/SpeechSynthesis behind a user gesture. `unlockAudio()` (resume ctx + speechSynthesis.resume()) is called from real gestures — opening the camera and toggling sound — so the first scan isn't silent. The hardware-scanner keydown path is itself a gesture so cue() resuming inline is enough there.

**iOS AC keepalive — polling approach fails:** A setInterval ping (every 4 s, one-shot silent oscillator burst) has two fatal races: (a) when suspended, the tick calls `resume()` and returns immediately — the silent note path is skipped, so the AC wakes then immediately re-suspends; (b) `getCtx()` returns the still-suspended context synchronously while resume() is pending — notes scheduled then are silently dropped.
**Fix:** attach a continuously-running oscillator at −100 dB gain on `startAudioKeepalive()`. While any audio node is actively outputting, iOS cannot suspend the context. Use `getRunningCtx()` (returns `Promise<AudioContext | null>`, awaits `resume()` before resolving) in `reportFilingSuccess()` — schedule melody notes only inside `.then()` so they always land on a running context.
