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
**Fix — silence oscillator:** attach a continuously-running oscillator at −100 dB gain via `attachSilenceGenerator()`. While any node is outputting, iOS cannot suspend. CRITICAL: the oscillator must be started AFTER the context is confirmed 'running' — starting it on a suspended context via `osc.start()` registers the node but iOS never wakes to play it, so the keepalive never activates. Use a `statechange` event listener: if `ac.state !== 'running'`, listen for the event and call `startOsc()` only when the state becomes 'running'.
**Fix — melody note scheduling:** on iOS, `currentTime` KEEPS ADVANCING while the context is suspended (non-spec but real). Notes scheduled at `currentTime` on a suspended context are already in the past when the context resumes → silently dropped. `cue("ok"/"err")` works because it fires within the iOS keyboard-event gesture window. Melody is called 300–500 ms later (after the API round-trip) — outside that window, context suspends, and notes are dropped.
**CRITICAL — do NOT use statechange events for this:** the statechange event fires while iOS is still *transitioning* to 'running'. `ac.state` can still read `'suspended'` inside the handler, so any `if (ac.state === 'running')` guard silently skips the callback and the melody is never played.
**Correct approach:** `ac.resume().then(fn)` — the Promise resolves ONLY after the context is CONFIRMED running. Inside fn, read `ac.currentTime + 0.05` (50 ms forward offset as extra safety margin). Melody functions accept caller-provided `t` so the timestamp is always fresh (never captured before the async gap). Use `"square"` wave at 0.17–0.19 gain. Silence oscillator gain should be `0.001` (−60 dB), not `0.00001` — iOS may treat near-zero output as "effectively silent" and suspend anyway.
