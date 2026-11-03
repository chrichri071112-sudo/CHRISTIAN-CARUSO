// VIP ONLY - Audio Chime, Wake Word ("JARVIS") and Hand Clap Detection

export interface VipSettings {
  wakeWordEnabled: boolean;
  clapEnabled: boolean;
  silenceSeconds: number;
}

const STORAGE_KEY_WAKE = 'jarvis.vip.wake_word';
const STORAGE_KEY_CLAP = 'jarvis.vip.clap';

export function getVipSettings(): VipSettings {
  let wakeWordEnabled = false;
  let clapEnabled = false;

  try {
    const w = localStorage.getItem(STORAGE_KEY_WAKE);
    if (w !== null) wakeWordEnabled = w === 'true';
    const c = localStorage.getItem(STORAGE_KEY_CLAP);
    if (c !== null) clapEnabled = c === 'true';
  } catch {}

  return {
    wakeWordEnabled,
    clapEnabled,
    silenceSeconds: 5,
  };
}

export function saveVipSettings(settings: Partial<VipSettings>) {
  try {
    if (settings.wakeWordEnabled !== undefined) {
      localStorage.setItem(STORAGE_KEY_WAKE, settings.wakeWordEnabled ? 'true' : 'false');
    }
    if (settings.clapEnabled !== undefined) {
      localStorage.setItem(STORAGE_KEY_CLAP, settings.clapEnabled ? 'true' : 'false');
    }
  } catch {}
}

// Synthesized futuristic JARVIS activation chime using Web Audio API
export function playJarvisChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First tone (587 Hz - D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(0.25, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second harmonic chime tone (1174 Hz - D6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.25);

    gain2.gain.setValueAtTime(0.001, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.18, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.42);

    // Third crystalline harmonic tone (1760 Hz - A6) for 300 IQ quantum activation
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1174.66, now + 0.14);
    osc3.frequency.exponentialRampToValueAtTime(1760, now + 0.32);

    gain3.gain.setValueAtTime(0.001, now + 0.14);
    gain3.gain.linearRampToValueAtTime(0.12, now + 0.17);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.14);
    osc3.stop(now + 0.52);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 700);
  } catch (err) {
    console.warn('Audio chime failed:', err);
  }
}

// Background Wake Word & Clap Detection Controller
class VipDetectionController {
  private isRunning = false;
  private isBusy = false;
  private wakeRecognition: any = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private lastClapTime = 0;
  private onTriggerCallback: ((type: 'wake_word' | 'clap') => void) | null = null;
  private onStatusChangeCallback: ((status: string) => void) | null = null;

  public init(
    onTrigger: (type: 'wake_word' | 'clap') => void,
    onStatusChange?: (status: string) => void
  ) {
    this.onTriggerCallback = onTrigger;
    this.onStatusChangeCallback = onStatusChange || null;
  }

  public setBusy(busy: boolean) {
    this.isBusy = busy;
    if (busy) {
      this.pauseRecognition();
    } else if (this.isRunning) {
      this.resumeRecognition();
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const settings = getVipSettings();

    if (settings.wakeWordEnabled) {
      this.startWakeWord();
    }
    if (settings.clapEnabled) {
      this.startClapDetection();
    }

    this.onStatusChangeCallback?.('Ascolto VIP attivo');
  }

  public stop() {
    this.isRunning = false;
    this.stopWakeWord();
    this.stopClapDetection();
    this.onStatusChangeCallback?.('Ascolto VIP disattivato');
  }

  public restartWithSettings() {
    this.stop();
    this.start();
  }

  // --- Speech Recognition for Wake Word "JARVIS" ---
  private startWakeWord() {
    const win = window as any;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('SpeechRecognition not available in this browser');
      return;
    }

    try {
      const rec = new SpeechRec();
      this.wakeRecognition = rec;
      rec.lang = 'it-IT';
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (event: any) => {
        if (this.isBusy) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          // Check for "jarvis", "ehi jarvis", "hey jarvis", "ciao jarvis"
          if (/\b(jarvis|arvis|giarvis|ehi jarvis|hey jarvis|ciao jarvis)\b/i.test(transcript)) {
            console.log('VIP Wake Word detected:', transcript);
            this.handleTrigger('wake_word');
            break;
          }
        }
      };

      rec.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          this.onStatusChangeCallback?.('Permesso microfono negato');
        }
      };

      rec.onend = () => {
        // Automatically restart if still running and not busy
        if (this.isRunning && !this.isBusy) {
          try {
            rec.start();
          } catch {}
        }
      };

      rec.start();
    } catch (err) {
      console.warn('Failed to start wake word detector:', err);
    }
  }

  private pauseRecognition() {
    try {
      this.wakeRecognition?.stop();
    } catch {}
  }

  private resumeRecognition() {
    try {
      this.wakeRecognition?.start();
    } catch {}
  }

  private stopWakeWord() {
    try {
      if (this.wakeRecognition) {
        this.wakeRecognition.onend = null;
        this.wakeRecognition.abort();
        this.wakeRecognition = null;
      }
    } catch {}
  }

  // --- Hand Clap Detection via Web Audio API ---
  private async startClapDetection() {
    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      this.mediaStream = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.08;
      source.connect(analyser);
      this.analyser = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let prevVolume = 0;
      let lastTypingTime = 0;

      const recordTyping = () => {
        lastTypingTime = Date.now();
      };

      window.addEventListener('keydown', recordTyping, true);
      window.addEventListener('keyup', recordTyping, true);
      window.addEventListener('input', recordTyping, true);

      const detectClap = () => {
        if (!this.isRunning) return;

        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        let maxVal = 0;

        for (let i = 0; i < bufferLength; i++) {
          const val = dataArray[i];
          sum += val;
          if (val > maxVal) maxVal = val;
        }
        const volume = sum / bufferLength;
        const delta = volume - prevVolume;
        prevVolume = volume;

        const now = Date.now();
        // Keyboard suppression: ignore if any key was pressed in last 1.5 seconds
        const isRecentTyping = now - lastTypingTime < 1500;
        // Check if an input or textarea or editable field currently has focus
        const activeEl = document.activeElement;
        const isEditingField =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            (activeEl as HTMLElement).isContentEditable);

        // Responsive clap detection: sharp transient spike while not typing
        const isClap = delta > 45 && volume > 42 && maxVal > 145;

        if (
          isClap &&
          !isRecentTyping &&
          !isEditingField &&
          now - this.lastClapTime > 1800 &&
          !this.isBusy
        ) {
          this.lastClapTime = now;
          console.log('VIP Hand Clap verified:', { volume, delta, maxVal });
          this.handleTrigger('clap');
        }

        this.animFrameId = requestAnimationFrame(detectClap);
      };

      this.animFrameId = requestAnimationFrame(detectClap);
    } catch (err) {
      console.warn('Microphone permission for clap detection not granted:', err);
    }
  }

  private stopClapDetection() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }

  private handleTrigger(type: 'wake_word' | 'clap') {
    this.setBusy(true);
    playJarvisChime();
    this.onTriggerCallback?.(type);
  }
}

export const vipController = new VipDetectionController();
