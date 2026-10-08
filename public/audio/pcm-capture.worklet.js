/* global AudioWorkletProcessor, registerProcessor, sampleRate */

// Resample the microphone's actual rate; AudioContext's requested rate is only a hint.
const TARGET_RATE = 16_000;
const PACKET_SAMPLES = 1_600;
const MAX_SAMPLES = TARGET_RATE * 60;

class LedgerPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.samples = 0;
    this.packetSamples = 0;
    this.packet = new DataView(new ArrayBuffer(PACKET_SAMPLES * 2));
    this.windowWeight = 0;
    this.windowSum = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'stop') this.stop();
    };
  }

  flushPacket() {
    if (this.packetSamples === 0) return;
    const buffer = this.packetSamples === PACKET_SAMPLES
      ? this.packet.buffer
      : this.packet.buffer.slice(0, this.packetSamples * 2);
    this.port.postMessage({ type: 'audio', buffer, samples: this.samples }, [buffer]);
    this.packet = new DataView(new ArrayBuffer(PACKET_SAMPLES * 2));
    this.packetSamples = 0;
  }

  appendSample(value) {
    if (this.samples >= MAX_SAMPLES) return;
    const bounded = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    const pcm = Math.round(bounded * (bounded < 0 ? 0x8000 : 0x7fff));
    this.packet.setInt16(this.packetSamples * 2, pcm, true);
    this.packetSamples += 1;
    this.samples += 1;
    if (this.packetSamples === PACKET_SAMPLES) this.flushPacket();
    if (this.samples === MAX_SAMPLES) this.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    // A last incomplete resampling window still contains microphone audio.
    if (this.windowWeight > 0 && this.samples < MAX_SAMPLES) {
      this.appendSample(this.windowSum / this.windowWeight);
    }
    this.windowWeight = 0;
    this.windowSum = 0;
    this.flushPacket();
    this.port.postMessage({ type: 'stopped' });
  }

  process(inputs, outputs) {
    // The node is connected to the destination to keep processing active; never
    // route microphone audio to speakers, including after capture has stopped.
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;

    for (let frame = 0; frame < channels[0].length && !this.stopped; frame += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[frame];
      mono /= channels.length;

      // Each source sample spans TARGET_RATE integer time units; a destination
      // window spans sampleRate units. The weighted mean is a box low-pass
      // filter, with its fractional phase retained between render quanta.
      let remaining = TARGET_RATE;
      while (remaining > 0 && !this.stopped) {
        const weight = Math.min(remaining, sampleRate - this.windowWeight);
        this.windowSum += mono * weight;
        this.windowWeight += weight;
        remaining -= weight;
        if (this.windowWeight === sampleRate) {
          const value = this.windowSum / sampleRate;
          this.windowWeight = 0;
          this.windowSum = 0;
          this.appendSample(value);
        }
      }
    }
    return !this.stopped;
  }
}

registerProcessor('ledger-pcm-capture', LedgerPcmCaptureProcessor);
