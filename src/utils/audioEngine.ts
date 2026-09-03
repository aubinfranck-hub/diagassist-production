/**
 * DiagAssist v1 Pro - V8 GLE Engine Sound Synthesizer
 * Uses Web Audio API to procedurally generate a highly realistic V8 start-up sound.
 */

export function playV8EngineSound() {
  // Support standard and prefixed audio contexts
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0, ctx.currentTime);
  mainGain.connect(ctx.destination);

  // Overall volume fade-in and eventual fade-out
  mainGain.gain.linearRampToValueAtTime(1.6, ctx.currentTime + 0.05);

  const now = ctx.currentTime;

  // --- PART 1: STARTER MOTOR CRANKING ---
  // A V8 starter motor makes a rhythmic whirring/cranking sound: "chi-chi-chi-chi-chi"
  // We simulate this with 5 cranking impulses spaced 140ms apart.
  const crankInterval = 0.14;
  const crankCount = 5;

  for (let i = 0; i < crankCount; i++) {
    const crankTime = now + i * crankInterval;
    
    // Crank click sound (high pass noise burst)
    const bufferSize = ctx.sampleRate * 0.08; // 80ms buffer
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < bufferSize; j++) {
      data[j] = Math.random() * 2 - 1;
    }

    const noiseNode = ctx.createBufferSource();
    noiseNode.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(450, crankTime);
    noiseFilter.Q.setValueAtTime(3.0, crankTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, crankTime);
    noiseGain.gain.linearRampToValueAtTime(0.28, crankTime + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, crankTime + 0.07);

    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(mainGain);
    noiseNode.start(crankTime);

    // Crank cylinder compression hump (low-frequency hum)
    const compressionOsc = ctx.createOscillator();
    compressionOsc.type = "triangle";
    compressionOsc.frequency.setValueAtTime(45, crankTime);
    compressionOsc.frequency.exponentialRampToValueAtTime(15, crankTime + 0.1);

    const compressionGain = ctx.createGain();
    compressionGain.gain.setValueAtTime(0, crankTime);
    compressionGain.gain.linearRampToValueAtTime(1.1, crankTime + 0.02);
    compressionGain.gain.exponentialRampToValueAtTime(0.001, crankTime + 0.12);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(90, crankTime);

    compressionOsc.connect(lowpass);
    lowpass.connect(compressionGain);
    compressionGain.connect(mainGain);

    compressionOsc.start(crankTime);
    compressionOsc.stop(crankTime + 0.15);
  }

  // --- PART 2: ENGINE IGNITION & REV UP ("VROOM") ---
  // Ignition happens right after the starter finished cranking
  const ignitionTime = now + crankCount * crankInterval;

  // We use multiple detuned oscillators to create a massive, thick V8 cylinder sound
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const osc3 = ctx.createOscillator();
  const subOsc = ctx.createOscillator();

  osc1.type = "sawtooth";
  osc2.type = "sawtooth";
  osc3.type = "triangle";
  subOsc.type = "sine"; // Sub-bass weight

  // Standard detune for that thick multi-cylinder chorusing effect
  osc1.detune.setValueAtTime(-12, ignitionTime);
  osc2.detune.setValueAtTime(12, ignitionTime);
  
  // GLE AMG V8 ignition curve: starts low, bursts up to 135Hz in a fraction of a second, then decays to idle
  // Cylinder base frequency: 32Hz (low rumbling idle)
  const idleFreq = 34;
  const maxRevFreq = 140;

  osc1.frequency.setValueAtTime(25, ignitionTime);
  osc2.frequency.setValueAtTime(25, ignitionTime);
  osc3.frequency.setValueAtTime(25, ignitionTime);
  subOsc.frequency.setValueAtTime(25, ignitionTime);

  // Rev peak at +0.3s after ignition
  const peakTime = ignitionTime + 0.32;
  osc1.frequency.exponentialRampToValueAtTime(maxRevFreq, peakTime);
  osc2.frequency.exponentialRampToValueAtTime(maxRevFreq + 1, peakTime);
  osc3.frequency.exponentialRampToValueAtTime(maxRevFreq - 1, peakTime);
  subOsc.frequency.exponentialRampToValueAtTime(maxRevFreq / 2, peakTime); // Sub is an octave lower

  // Settles to idle at +1.4s
  const idleSettledTime = ignitionTime + 1.3;
  osc1.frequency.exponentialRampToValueAtTime(idleFreq, idleSettledTime);
  osc2.frequency.exponentialRampToValueAtTime(idleFreq + 0.8, idleSettledTime);
  osc3.frequency.exponentialRampToValueAtTime(idleFreq, idleSettledTime);
  subOsc.frequency.exponentialRampToValueAtTime(idleFreq, idleSettledTime);

  // Modulate frequencies slightly at idle to represent raw, irregular V8 idling
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(6.5, ignitionTime); // 6.5 Hz combustion rhythm

  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(3.2, ignitionTime); // Pitch variance in Hz

  lfo.connect(lfoGain);
  lfoGain.connect(osc1.frequency);
  lfoGain.connect(osc2.frequency);
  lfoGain.connect(subOsc.frequency);

  // Combustion exhaust gas exhaust sound (filtered white noise)
  const exhaustBufferSize = ctx.sampleRate * 4; // 4 seconds of noise
  const exhaustBuffer = ctx.createBuffer(1, exhaustBufferSize, ctx.sampleRate);
  const exhaustData = exhaustBuffer.getChannelData(0);
  for (let j = 0; j < exhaustBufferSize; j++) {
    exhaustData[j] = Math.random() * 2 - 1;
  }
  const exhaustNode = ctx.createBufferSource();
  exhaustNode.buffer = exhaustBuffer;
  exhaustNode.loop = true;

  const exhaustFilter = ctx.createBiquadFilter();
  exhaustFilter.type = "lowpass";
  // The exhaust filter opens during the rev and closes back down
  exhaustFilter.frequency.setValueAtTime(90, ignitionTime);
  exhaustFilter.frequency.exponentialRampToValueAtTime(580, peakTime);
  exhaustFilter.frequency.exponentialRampToValueAtTime(140, idleSettledTime);
  exhaustFilter.Q.setValueAtTime(2.5, ignitionTime);

  const exhaustGain = ctx.createGain();
  exhaustGain.gain.setValueAtTime(0, ignitionTime);
  exhaustGain.gain.linearRampToValueAtTime(0.85, ignitionTime + 0.1);
  exhaustGain.gain.exponentialRampToValueAtTime(0.55, peakTime);
  exhaustGain.gain.exponentialRampToValueAtTime(0.38, idleSettledTime);

  exhaustNode.connect(exhaustFilter);
  exhaustFilter.connect(exhaustGain);
  exhaustGain.connect(mainGain);

  // Volume envelopes for oscillators
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, ignitionTime);
  // Explosive startup fire-up volume
  oscGain.gain.linearRampToValueAtTime(1.3, ignitionTime + 0.08);
  oscGain.gain.exponentialRampToValueAtTime(1.0, peakTime);
  // Decays into heavy rumbling idle
  oscGain.gain.exponentialRampToValueAtTime(0.75, idleSettledTime);

  // Main Low-pass EQ to keep it extremely heavy and bassy (no high sizzle)
  const mainFilter = ctx.createBiquadFilter();
  mainFilter.type = "lowpass";
  mainFilter.frequency.setValueAtTime(260, ignitionTime);
  mainFilter.frequency.exponentialRampToValueAtTime(450, peakTime);
  mainFilter.frequency.exponentialRampToValueAtTime(180, idleSettledTime);

  osc1.connect(mainFilter);
  osc2.connect(mainFilter);
  osc3.connect(mainFilter);
  subOsc.connect(mainFilter);

  mainFilter.connect(oscGain);
  oscGain.connect(mainGain);

  // Start sound generation
  lfo.start(ignitionTime);
  osc1.start(ignitionTime);
  osc2.start(ignitionTime);
  osc3.start(ignitionTime);
  subOsc.start(ignitionTime);
  exhaustNode.start(ignitionTime);

  // Fading out the engine after idling
  const fadeStartTime = now + 3.8;
  const stopTime = now + 4.5;
  mainGain.gain.setValueAtTime(1.6, fadeStartTime);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

  // Clean stop all nodes
  lfo.stop(stopTime);
  osc1.stop(stopTime);
  osc2.stop(stopTime);
  osc3.stop(stopTime);
  subOsc.stop(stopTime);
  exhaustNode.stop(stopTime);
}

/**
 * Play a high-tech chime sound when the microphone starts listening
 */
export function playMicStartSound() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "sine";
  osc2.type = "triangle";

  osc1.frequency.setValueAtTime(523.25, now); // C5
  osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.12); // G5

  osc2.frequency.setValueAtTime(523.25, now);
  osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.3);
  osc2.stop(now + 0.3);
}

/**
 * Play a professional tone when the microphone stops or times out
 */
export function playMicStopSound() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "sine";
  osc1.frequency.setValueAtTime(659.25, now); // E5
  osc1.frequency.exponentialRampToValueAtTime(440.00, now + 0.15); // A4

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc1.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc1.stop(now + 0.35);
}

/**
 * Play a double-chime diagnostic notification sound when a message or report is ready
 */
export function playNotificationSound() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  // Double high chime
  osc.frequency.setValueAtTime(880, now); // A5
  osc.frequency.setValueAtTime(1046.50, now + 0.08); // C6

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.08);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.5);
}

/**
 * Play a quick robotic click or beep feedback for standard keys or selections
 */
export function playClickFeedbackSound() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.03);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}
