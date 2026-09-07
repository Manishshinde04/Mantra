import { prepareTextForSpeech } from "./textProcessor";

export class SentenceSegmenter {
  private buffer: string = "";
  private emittedSentenceCount: number = 0;

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
        this.emittedSentenceCount++;
        console.log("[VOXFLOW-E2E]", {
          component: "SEGMENTER",
          event: "sentence emitted",
          sentenceIndex: this.emittedSentenceCount - 1,
          sentenceTextLength: cleanSpoken.length,
          timestamp: Date.now(),
        });
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
        this.emittedSentenceCount++;
        console.log("[VOXFLOW-E2E]", {
          component: "SEGMENTER",
          event: "sentence emitted (flush)",
          sentenceIndex: this.emittedSentenceCount - 1,
          sentenceTextLength: cleanSpoken.length,
          timestamp: Date.now(),
        });
      }
    }

    // 2. Guarantee trailing buffer without formal punctuation is never dropped
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (remaining) {
      const cleanSpoken = prepareTextForSpeech(remaining);
      if (cleanSpoken.length > 0) {
        readySentences.push(cleanSpoken);
        this.emittedSentenceCount++;
        console.log("[VOXFLOW-E2E]", {
          component: "SEGMENTER",
          event: "sentence emitted (trailing flush)",
          sentenceIndex: this.emittedSentenceCount - 1,
          sentenceTextLength: cleanSpoken.length,
          timestamp: Date.now(),
        });
      }
    }

    console.log("[VOXFLOW-E2E]", {
      component: "SEGMENTER",
      event: "final buffer flushed",
      remainingBufferLength: this.buffer.length, // Verified 0
      totalEmitted: this.emittedSentenceCount,
      timestamp: Date.now(),
    });

    return readySentences;
  }

  public reset(): void {
    this.buffer = "";
    this.emittedSentenceCount = 0;
  }

  public getRemainingBufferLength(): number {
    return this.buffer.length;
  }

  private extractNextSentence(): string | null {
    // Strip leading newlines and whitespace so buffer doesn't stall on empty candidate
    this.buffer = this.buffer.replace(/^[\s\r\n]+/, "");
    if (!this.buffer) return null;

    let searchOffset = 0;
    while (searchOffset < this.buffer.length) {
      const sub = this.buffer.substring(searchOffset);

      // Low-latency optimization: for the very first chunk only, allow splitting at a natural clause break
      // (comma, semicolon, colon) if at least 6 words have accumulated, to minimize Time-To-First-Audio (TTFA).
      let match = sub.match(/([.!?\n]|[\u0964\u0965])(\s+|$)/);
      if (this.emittedSentenceCount === 0 && (!match || match.index === undefined || match.index > 80)) {
        const clauseMatch = sub.match(/([,;:])(\s+)/);
        if (clauseMatch && clauseMatch.index !== undefined) {
          const candidateBeforeClause = sub.substring(0, clauseMatch.index).trim();
          const wordCount = candidateBeforeClause.split(/\s+/).length;
          if (wordCount >= 6 && wordCount <= 14) {
            match = clauseMatch;
          }
        }
      }

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
