type SpeechEvent = {
  type: string; item_id?: string; previous_item_id?: string | null;
  item?: { id?: string }; text?: string; stash?: string; transcript?: string;
};

// ASR previews are full sentence snapshots, not deltas. Keep each sentence in
// speech order even when the final result arrives after the next sentence.
export class SpeechTranscript {
  private order: string[] = [];
  private items = new Map<string, { text: string; final: boolean }>();

  update(event: SpeechEvent): string {
    const id = event.item_id || event.item?.id;
    if (!id) return this.text;
    if (!this.items.has(id)) {
      this.items.set(id, { text: "", final: false });
      this.order.push(id);
    }
    if (event.type === "input_audio_buffer.committed" || event.type === "conversation.item.created") {
      if (event.previous_item_id === null || this.order.includes(event.previous_item_id || "")) {
        this.order = this.order.filter(value => value !== id);
        this.order.splice(event.previous_item_id === null ? 0 : this.order.indexOf(event.previous_item_id!) + 1, 0, id);
      }
    }
    const item = this.items.get(id)!;
    if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
      item.text = event.transcript.slice(0, 4000); item.final = true;
    } else if (event.type === "conversation.item.input_audio_transcription.text" && !item.final) {
      item.text = `${event.text || ""}${event.stash || ""}`.slice(0, 4000);
    }
    return this.text;
  }

  get text(): string { return this.order.map(id => this.items.get(id)!.text).join("").slice(0, 4000); }
  get complete(): boolean { return [...this.items.values()].every(item => item.final || !item.text); }
}

export function appendSpeechTranscript(input: string, transcript: string): string {
  if (!transcript) return input;
  const separator = input && !/[\s，。！？、；：,.!?;:]$/.test(input) ? "，" : "";
  return `${input}${separator}${transcript}`.slice(0, 4000);
}
