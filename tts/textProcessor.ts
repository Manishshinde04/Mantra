/**
 * Sanitizes and optimizes raw AI markdown text into natural, speakable prose
 * suitable for text-to-speech engines without reciting markdown symbols or syntax.
 */
export function prepareTextForSpeech(rawText: string): string {
  if (!rawText) return "";

  let text = rawText;

  // 1. Remove fenced code blocks completely or replace with natural spoken transition
  text = text.replace(/```[\s\S]*?```/g, " I've provided the code in the response. ");

  // 2. Remove inline code backticks while preserving the term
  text = text.replace(/`([^`]+)`/g, "$1");

  // 3. Remove Markdown headers (### Header -> Header.)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1. ");

  // 4. Remove Markdown blockquotes (> Quote -> Quote)
  text = text.replace(/^>\s+(.+)$/gm, "$1. ");

  // 5. Remove Markdown links [Title](URL) -> Title
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");

  // 6. Convert bullet lists (- Item or * Item) into natural sequential sentences
  text = text.replace(/^\s*[-*+]\s+(.+)$/gm, "$1. ");

  // 7. Convert numbered lists (1. Item) into natural sentences
  text = text.replace(/^\s*\d+\.\s+(.+)$/gm, "$1. ");

  // 8. Remove bold / italic markup (**word** or *word* or _word_)
  text = text.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");

  // 9. Remove HTML tags if any
  text = text.replace(/<[^>]+>/g, " ");

  // 10. Remove excessive punctuation or isolated symbols
  text = text.replace(/[~`^|=]/g, " ");

  // 11. Normalize multiple spaces, periods, and newlines
  text = text
    .replace(/\.{2,}/g, ".")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}
