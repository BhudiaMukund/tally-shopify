/**
 * The lock confirmation: a tick you can hear and a bump you can feel.
 *
 * Both matter more here than they would in an ordinary app. The phone is held
 * at arm's length pointing at a shelf, so the person is looking at the *item*,
 * not the screen — the confirmation has to reach them without being read.
 *
 * A short synthesised blip rather than an audio file: no request, no decode, no
 * asset to ship, and it stays audible over a stockroom radio because it is a
 * clean tone rather than a click.
 */

const TICK_HZ = 1_320;
const TICK_MS = 55;
/** Quiet enough not to be annoying at arm's length, loud enough over a fridge. */
const TICK_GAIN = 0.09;

/** The haptic, in milliseconds. Short: this confirms, it does not alert. */
const HAPTIC_MS = 30;

let context: AudioContext | null = null;
let unavailable = false;

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  );
}

/**
 * Creates the audio context, or wakes a suspended one.
 *
 * Must be called from a real user gesture the first time. Browsers start an
 * `AudioContext` suspended when it was not, and a scan is not a gesture — the
 * tap that started the camera is, which is where `/scan` calls this.
 */
export function primeFeedback(): void {
  if (unavailable) return;
  const Constructor = audioContextConstructor();
  if (Constructor === undefined) {
    unavailable = true;
    return;
  }

  try {
    context ??= new Constructor();
    if (context.state === "suspended") void context.resume();
  } catch {
    // An audio context can be refused outright — an embedded webview with
    // media blocked, for instance. The haptic still works, so this is not
    // worth surfacing.
    unavailable = true;
  }
}

function playTick(): void {
  if (context === null || context.state !== "running") return;

  try {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.value = TICK_HZ;

    // A hard start would click; an exponential tail is what makes it read as a
    // tick rather than a beep.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(TICK_GAIN, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + TICK_MS / 1000);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + TICK_MS / 1000 + 0.02);
  } catch {
    // Never let a confirmation sound break a scan.
  }
}

function vibrate(): void {
  // Absent on iOS and on desktop; present and harmless everywhere else.
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(HAPTIC_MS);
  } catch {
    // Some browsers throw when the page is not visible.
  }
}

/** Fired once per accepted scan, whichever source read it. */
export function confirmScan(): void {
  vibrate();
  playTick();
}
