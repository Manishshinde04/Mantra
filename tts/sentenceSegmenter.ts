import { prepareTextForSpeech } from "./textProcessor";

export class SentenceSegmenter {
  private buffer: string = "";

  // Common abbreviations to avoid premature segmentation
  private static ABBREVIATIONS = new Set([
    "mr", "mrs", "dr", "ms", "prof", "vs", "etc", "e.g", "i.e", "gen", "rep", "sen", "fig", "no", "vol", "p.m", "a.m",
  ]);

  public append(textChunk: string): string[] {
    this.buffer += textChunk;
    const readySentences: string[] = [];

    while (true) {
      const sentence = this.extractNextSentence();
      if (!sentence) break;

      const cleanSpoken = prepareTextForSpeech(sentence);
      if (cleanSpoken.length > 0) {
        readySentences.push(cleanSpoken);
      }
    }

    return readySentences;
  }

  public flush(): string[] {
    const readySentences: string[] = [];

    // 1. Extract any complete sentences still held in the buffer
    while (true) {
      const sentence = this.extractNextSentence();
      if (!sentence) break;

      const cleanSpoken = prepareTextForSpeech(sentence);
      if (cleanSpoken.length > 0) {
        readySentences.push(cleanSpoken);
      }
    }

    // 2. Guarantee trailing buffer without formal punctuation is never dropped
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (remaining) {
      const cleanSpoken = prepareTextForSpeech(remaining);
      if (cleanSpoken.length > 0) {
        readySentences.push(cleanSpoken);
      }
    }

    return readySentences;
  }

  public reset(): void {
    this.buffer = "";
  }

  private extractNextSentence(): string | null {
    // Strip leading newlines and whitespace so buffer doesn't stall on empty candidate
    this.buffer = this.buffer.replace(/^[\s\r\n]+/, "");
    if (!this.buffer) return null;

    let searchOffset = 0;
    while (searchOffset < this.buffer.length) {
      const sub = this.buffer.substring(searchOffset);
      const match = sub.match(/([.!?।\n])(\s+|$)/);
      if (!match || match.index === undefined) {
        return null; // No boundary found in current buffer
      }

      const matchIndex = searchOffset + match.index;
      const terminator = match[1];
      const candidate = this.buffer.substring(0, matchIndex + 1);

      // Verify period is not a decimal number or abbreviation
      if (terminator === ".") {
        // Lookahead check: decimal number like 3.5 or v1.2
        const afterTerminator = this.buffer.charAt(matchIndex + 1);
        if (/\d/.test(afterTerminator)) {
          searchOffset = matchIndex + 1;
          continue;
        }

        // Numbered list item check: e.g. "1.", "2.", "10."
        const beforeCandidate = candidate.substring(0, candidate.length - 1).trim();
        if (/^\d+$/.test(beforeCandidate)) {
          searchOffset = matchIndex + 1;
          continue;
        }

        // Abbreviation check
        const words = candidate.trim().split(/\s+/);
        const lastWord = words[words.length - 1].toLowerCase().replace(/\.$/, "");
        if (SentenceSegmenter.ABBREVIATIONS.has(lastWord)) {
          searchOffset = matchIndex + 1;
          continue;
        }
      }

      // Valid boundary found. Advance buffer past terminator and following whitespace
      const fullEndIndex = matchIndex + match[0].length;
      this.buffer = this.buffer.substring(fullEndIndex);
      return candidate.trim();
    }

    return null;
  }
}
