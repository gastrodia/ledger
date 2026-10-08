/* eslint-disable @typescript-eslint/no-require-imports -- browser worklet runs in a VM fixture. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/audio/pcm-capture.worklet.js', 'utf8');

function capture(rate) {
  const messages = [];
  let Processor;
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage(message, transfers) {
          if (message.type === 'audio') {
            assert.equal(transfers.length, 1);
            assert.equal(transfers[0], message.buffer);
            // Transfer ownership just like a real MessagePort: reusing the old
            // DataView after flush would now fail with a detached-buffer error.
            messages.push(structuredClone(message, { transfer: transfers }));
          } else messages.push(structuredClone(message));
        } };
      }
    },
    registerProcessor(name, value) {
      assert.equal(name, 'ledger-pcm-capture');
      Processor = value;
    },
    sampleRate: rate,
  });
  const processor = new Processor();
  return {
    messages,
    process(channels) {
      const output = [new Float32Array(channels[0]?.length || 128).fill(1)];
      const active = processor.process([channels], [output]);
      assert.ok(output[0].every(value => value === 0), 'microphone is never played back');
      return active;
    },
    stop() { processor.port.onmessage({ data: { type: 'stop' } }); },
    audio() { return messages.filter(message => message.type === 'audio'); },
    pcm() {
      return messages.filter(message => message.type === 'audio').flatMap(message => {
        const data = new DataView(message.buffer);
        return Array.from({ length: data.byteLength / 2 }, (_, i) => data.getInt16(i * 2, true));
      });
    },
  };
}

function feed(capture, channels, chunkSize) {
  for (let offset = 0; offset < channels[0].length; offset += chunkSize) {
    if (!capture.process(channels.map(channel => channel.subarray(offset, offset + chunkSize)))) break;
  }
}

for (const rate of [16_000, 44_100, 48_000]) {
  test(`${rate} Hz yields exact 100 ms packets and preserves final audio`, () => {
    const recording = capture(rate);
    const frames = Math.floor(rate * 0.231) + 1;
    feed(recording, [new Float32Array(frames).fill(0.5)], 128);
    assert.equal(recording.audio().length, 2, 'packets arrive during recording');
    assert.deepEqual(recording.audio().map(packet => packet.samples), [1600, 3200]);
    assert.ok(recording.audio().every(packet => packet.buffer.byteLength === 3200));
    recording.stop();
    const expectedSamples = Math.ceil(frames * 16_000 / rate);
    assert.equal(recording.pcm().length, expectedSamples);
    assert.ok(recording.pcm().every(sample => sample === 16384));
    assert.equal(recording.audio().at(-1).samples, expectedSamples);
    assert.equal(recording.audio().at(-1).buffer.byteLength, (expectedSamples - 3200) * 2);
    assert.equal(recording.messages.at(-1).type, 'stopped');
    assert.equal(recording.process([new Float32Array(128)]), false);
    recording.stop();
    assert.equal(recording.messages.filter(message => message.type === 'stopped').length, 1);
  });

  test(`${rate} Hz resampling is independent of render-block boundaries`, () => {
    const signal = Float32Array.from({ length: rate + 7 }, (_, i) =>
      0.6 * Math.sin(2 * Math.PI * 741 * i / rate) + 0.2 * Math.sin(2 * Math.PI * 311 * i / rate));
    const contiguous = capture(rate);
    const blocks = capture(rate);
    const irregular = capture(rate);
    feed(contiguous, [signal], signal.length);
    feed(blocks, [signal], 128);
    feed(irregular, [signal], 73);
    for (const recording of [contiguous, blocks, irregular]) recording.stop();
    assert.deepEqual(blocks.pcm(), contiguous.pcm());
    assert.deepEqual(irregular.pcm(), contiguous.pcm());
    assert.equal(blocks.pcm().length, Math.ceil(signal.length * 16_000 / rate));
  });

  test(`${rate} Hz automatically stops at exactly 60 seconds`, () => {
    const recording = capture(rate);
    const quantum = new Float32Array(128).fill(-0.25);
    let frames = 0;
    let active = true;
    while (active && frames < rate * 61) {
      active = recording.process([quantum]);
      frames += quantum.length;
    }
    assert.equal(active, false);
    assert.ok(frames >= rate * 60 && frames < rate * 60 + quantum.length);
    assert.equal(recording.audio().length, 600);
    assert.equal(recording.audio().at(-1).samples, 960_000);
    assert.ok(recording.audio().every(packet => packet.buffer.byteLength === 3200));
    assert.equal(recording.messages.at(-1).type, 'stopped');
    const count = recording.messages.length;
    recording.stop();
    assert.equal(recording.process([quantum]), false);
    assert.equal(recording.messages.length, count);
  });
}

test('PCM output averages channels, clips values, and uses signed little endian', () => {
  const recording = capture(16_000);
  recording.process([
    Float32Array.from([1, -1, 2, -2, 0.5, -0.5, 1, NaN]),
    Float32Array.from([1, -1, 2, -2, 0.5, -0.5, -1, NaN]),
  ]);
  recording.stop();
  assert.deepEqual(recording.pcm(), [32767, -32768, 32767, -32768, 16384, -16384, 0, 0]);
  assert.deepEqual(Array.from(new Uint8Array(recording.audio()[0].buffer).slice(0, 4)), [255, 127, 0, 128]);
});

test('resampling weights source samples and keeps a last incomplete window', () => {
  const recording = capture(48_000);
  recording.process([Float32Array.from([0, 0.3, 0.6, 0.75])]);
  recording.stop();
  assert.deepEqual(recording.pcm(), [9830, 24575]);

  const partial = capture(44_100);
  partial.process([Float32Array.from([0.5])]);
  partial.stop();
  assert.deepEqual(partial.pcm(), [16384]);
});

test('empty input waits silently and stopping before any audio sends no empty packet', () => {
  const recording = capture(48_000);
  assert.equal(recording.process([]), true);
  assert.deepEqual(recording.messages, []);
  recording.stop();
  assert.deepEqual(recording.messages, [{ type: 'stopped' }]);
});
