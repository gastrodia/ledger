export const MAX_AUDIO_SECONDS = 60;

export function encodePcmWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => { const s = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + index * 2, s < 0 ? s * 32768 : s * 32767, true); });
  return buffer;
}

// Reject malformed or oversized uploads before any paid transcription call.
export function validatePcmWav(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 46 || buffer.byteLength > 44 + MAX_AUDIO_SECONDS * 16000 * 2) return false;
  const v = new DataView(buffer);
  const text = (offset: number, length: number) => Array.from({ length }, (_, i) => String.fromCharCode(v.getUint8(offset + i))).join("");
  return text(0, 4) === "RIFF" && text(8, 4) === "WAVE" && text(12, 4) === "fmt " && text(36, 4) === "data"
    && v.getUint32(4, true) === buffer.byteLength - 8 && v.getUint32(16, true) === 16 && v.getUint16(20, true) === 1
    && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16000 && v.getUint32(28, true) === 32000
    && v.getUint16(32, true) === 2 && v.getUint16(34, true) === 16 && v.getUint32(40, true) === buffer.byteLength - 44
    && (buffer.byteLength - 44) % 2 === 0;
}

export async function recordingToWav(blob: Blob, clipToLimit = false): Promise<Blob> {
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    if ((!clipToLimit && decoded.duration > MAX_AUDIO_SECONDS) || decoded.duration <= 0) throw new Error("录音请控制在60秒以内。");
    // MediaRecorder may stop a fraction late. Keep an automatic 60-second stop
    // usable while still rejecting overlong files selected by the user.
    const duration = Math.min(decoded.duration, MAX_AUDIO_SECONDS);
    const offline = new OfflineAudioContext(1, Math.ceil(duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const resampled = await offline.startRendering();
    return new Blob([encodePcmWav(resampled.getChannelData(0))], { type: "audio/wav" });
  } finally { await audioContext.close(); }
}
