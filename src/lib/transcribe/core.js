/** Shared, side-effect-free helpers. Also tested with Node's built-in test runner. */
export const SAMPLE_RATE = 16000;
export const CHUNK_SECONDS = 30;
export const STRIDE_SECONDS = 5;
export const MAX_FILE_BYTES = 250 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 30 * 60;
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
export const MODELS = Object.freeze({
  en: 'onnx-community/whisper-tiny.en',
  other: 'onnx-community/whisper-tiny',
});

// Whisper tiny's 98 non-English language tokens. Explicit selection is intentional:
// Transformers.js 3.8.1 does NOT implement Whisper language auto-detection.
export const LANGUAGES = Object.freeze([
  ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'],
  ['hy', 'Armenian'], ['as', 'Assamese'], ['az', 'Azerbaijani'], ['ba', 'Bashkir'],
  ['eu', 'Basque'], ['be', 'Belarusian'], ['bn', 'Bengali'], ['bs', 'Bosnian'],
  ['br', 'Breton'], ['bg', 'Bulgarian'], ['my', 'Burmese'], ['ca', 'Catalan'],
  ['zh', 'Chinese'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'],
  ['nl', 'Dutch'], ['et', 'Estonian'], ['fo', 'Faroese'], ['fi', 'Finnish'],
  ['fr', 'French'], ['gl', 'Galician'], ['ka', 'Georgian'], ['de', 'German'],
  ['el', 'Greek'], ['gu', 'Gujarati'], ['ht', 'Haitian Creole'], ['ha', 'Hausa'],
  ['haw', 'Hawaiian'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'],
  ['is', 'Icelandic'], ['id', 'Indonesian'], ['it', 'Italian'], ['ja', 'Japanese'],
  ['jw', 'Javanese'], ['kn', 'Kannada'], ['kk', 'Kazakh'], ['km', 'Khmer'],
  ['ko', 'Korean'], ['lo', 'Lao'], ['la', 'Latin'], ['lv', 'Latvian'],
  ['ln', 'Lingala'], ['lt', 'Lithuanian'], ['lb', 'Luxembourgish'], ['mk', 'Macedonian'],
  ['mg', 'Malagasy'], ['ms', 'Malay'], ['ml', 'Malayalam'], ['mt', 'Maltese'],
  ['mi', 'Māori'], ['mr', 'Marathi'], ['mn', 'Mongolian'], ['ne', 'Nepali'],
  ['no', 'Norwegian'], ['nn', 'Norwegian Nynorsk'], ['oc', 'Occitan'], ['ps', 'Pashto'],
  ['fa', 'Persian'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['pa', 'Punjabi'],
  ['ro', 'Romanian'], ['ru', 'Russian'], ['sa', 'Sanskrit'], ['sr', 'Serbian'],
  ['sn', 'Shona'], ['sd', 'Sindhi'], ['si', 'Sinhala'], ['sk', 'Slovak'],
  ['sl', 'Slovenian'], ['so', 'Somali'], ['es', 'Spanish'], ['su', 'Sundanese'],
  ['sw', 'Swahili'], ['sv', 'Swedish'], ['tl', 'Tagalog'], ['tg', 'Tajik'],
  ['ta', 'Tamil'], ['tt', 'Tatar'], ['te', 'Telugu'], ['th', 'Thai'],
  ['bo', 'Tibetan'], ['tr', 'Turkish'], ['tk', 'Turkmen'], ['uk', 'Ukrainian'],
  ['ur', 'Urdu'], ['uz', 'Uzbek'], ['vi', 'Vietnamese'], ['cy', 'Welsh'],
  ['yi', 'Yiddish'], ['yo', 'Yoruba'],
]);

export function modelForLanguage(language) {
  if (language === 'en') return MODELS.en;
  if (!LANGUAGES.some(([code]) => code === language)) throw new Error('Choose the language spoken in your video.');
  return MODELS.other;
}

export function languageLabel(language) {
  return language === 'en' ? 'English' : LANGUAGES.find(([code]) => code === language)?.[1] ?? language;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const value = Math.floor(seconds);
  const s = String(value % 60).padStart(2, '0');
  const m = String(Math.floor(value / 60) % 60).padStart(2, '0');
  return value >= 3600 ? `${Math.floor(value / 3600)}:${m}:${s}` : `${m}:${s}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateVideoFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error('That file is empty. Choose a video with audio.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a video under 250 MB. A shorter clip uses less device memory.');
  if (!file.type?.startsWith('video/') && !/\.(mp4|mov|webm|m4v|ogv|mkv)$/i.test(file.name ?? '')) {
    throw new Error('Choose a video file, such as MP4, MOV, or WebM.');
  }
}

export function numberOfWindows(duration) {
  return duration <= CHUNK_SECONDS ? 1 : Math.ceil((duration - CHUNK_SECONDS) / (CHUNK_SECONDS - 2 * STRIDE_SECONDS)) + 1;
}

export function processedSeconds(completed, duration) {
  if (completed <= 0) return 0;
  if (completed >= numberOfWindows(duration)) return duration;
  return Math.min(duration, CHUNK_SECONDS - STRIDE_SECONDS + (completed - 1) * (CHUNK_SECONDS - 2 * STRIDE_SECONDS));
}

export function wordCount(text, language = 'en') {
  if (!text.trim()) return 0;
  if (typeof Intl.Segmenter === 'function') {
    // Whisper's legacy jw code is jv in Intl APIs.
    const segmenter = new Intl.Segmenter(language === 'jw' ? 'jv' : language, { granularity: 'word' });
    return [...segmenter.segment(text)].filter(segment => segment.isWordLike).length;
  }
  return text.trim().split(/\s+/u).length;
}

/** Never insert model output or a filename using innerHTML. */
export function normalizeSegments(output, duration) {
  const fullText = String(output?.text ?? '').trim();
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  let lastStart = 0;
  const segments = chunks.filter(chunk => String(chunk.text ?? '').trim()).map(chunk => {
    const rawStart = chunk.timestamp?.[0];
    const start = Math.min(duration, Math.max(lastStart, Number.isFinite(rawStart) ? rawStart : lastStart));
    lastStart = start;
    const rawEnd = chunk.timestamp?.[1];
    return { text: String(chunk.text).trim(), start, end: Number.isFinite(rawEnd) ? Math.max(start, Math.min(duration, rawEnd)) : null };
  });
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end === null) segments[i].end = segments[i + 1]?.start ?? duration;
  }
  if (!segments.length && fullText) segments.push({ text: fullText, start: 0, end: duration });
  return { text: fullText || segments.map(segment => segment.text).join(' '), segments };
}

export function markdownTranscript(fileName, text) {
  const title = String(fileName).replace(/\.[^.]+$/, '').replace(/[\r\n]/g, ' ').trim() || 'Transcript';
  const escape = value => value.replace(/\\/g, '\\\\').replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]).replace(/([`*_\[\]#])/g, '\\$1');
  return `# ${escape(title)}\n\n${escape(text.trim())}\n`;
}

/** S1-mini by Superwhisper. Model-specific, side-effect-free integration helpers. */
export const SMART_TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
export const SMART_MODEL = 'onnx-community/s1-mini-ONNX';
export const SMART_REVISION = '545466fa40a4c79f4063cf5359df037dee8f2c8d';
export const SMART_MAX_INPUT_TOKENS = 700;
// Required training prompt and control values, as published by Superwhisper.
export const SMART_SYSTEM = 'You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text.';
export const SMART_CONTROL = '[Styling: semi-formal] [Structure: prose] [Context: general]';

export function sanitizeCleanupInput(text) {
  // Literal chat delimiters in an ASR result must not create additional roles.
  // The original, unmodified transcript is retained separately in the UI.
  return String(text).replace(/<\|[^<>\r\n]*\|>/g, value => value.replace('<', '‹').replace('>', '›'));
}

export function cleanupMessages(text) {
  const safeText = sanitizeCleanupInput(text);
  return [
    { role: 'system', content: SMART_SYSTEM },
    { role: 'user', content: `${SMART_CONTROL}\n${safeText}` },
  ];
}

/** Split at sentence boundaries where possible. Oversized sentences are split
 * at word boundaries, and pathological long words at Unicode code points.
 * Actual tokenizer counts, not character/word estimates, enforce the budget.
 * Each input span appears once; there is no overlapping text to duplicate.
 */
export function chunkForCleanup(text, countTokens, maxTokens = SMART_MAX_INPUT_TOKENS) {
  if (typeof countTokens !== 'function' || !Number.isInteger(maxTokens) || maxTokens < 8) throw new Error('Invalid cleanup chunk settings.');
  const raw = String(text).trim();
  if (!raw) return [];
  const fits = value => {
    const count = countTokens(value);
    if (!Number.isFinite(count) || count < 0) throw new Error('Could not count transcript tokens.');
    return count <= maxTokens;
  };
  const sentences = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(raw)].map(item => item.segment.trim()).filter(Boolean)
    : raw.match(/[^.!?]+[.!?]*(?:\s+|$)|.+/gu) || [raw];
  const pieces = [];
  for (let remaining of sentences) {
    while (remaining && !fits(remaining)) {
      const characters = Array.from(remaining);
      let low = 1, high = characters.length, best = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (fits(characters.slice(0, mid).join(''))) { best = mid; low = mid + 1; }
        else high = mid - 1;
      }
      if (!best) throw new Error('A transcript character exceeds the token budget.');
      let prefix = characters.slice(0, best).join('');
      const lastSpace = prefix.search(/\s+\S*$/u);
      if (lastSpace >= prefix.length * 0.55) prefix = prefix.slice(0, lastSpace);
      // Tokenization is not perfectly monotonic across subword boundaries.
      while (prefix && !fits(prefix)) prefix = Array.from(prefix).slice(0, -1).join('');
      if (!prefix.trim()) throw new Error('Could not split the transcript safely.');
      pieces.push(prefix.trim());
      remaining = remaining.slice(prefix.length).trim();
    }
    if (remaining) pieces.push(remaining);
  }
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (current && !fits(candidate)) { chunks.push(current); current = piece; }
    else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function cleanupOutput(result) {
  const generated = result?.[0]?.generated_text;
  const text = typeof generated === 'string' ? generated : Array.isArray(generated) && generated.at(-1)?.role === 'assistant' ? generated.at(-1).content : null;
  // An empty string is VALID: S1-mini intentionally removes filler-only input.
  if (typeof text !== 'string') throw new Error('S1-mini returned an unexpected result.');
  if (/<\/?think\b|<\|(?:im_start|im_end|endoftext)\|>/i.test(text)) throw new Error('S1-mini returned model control text.');
  return text.trim();
}

/** Read exact token counts from a Transformers.js tokenizer result. */
export function tokenCount(tokenizer, text) {
  const ids = tokenizer(String(text), { add_special_tokens: false }).input_ids;
  const count = ids?.size ?? ids?.dims?.at(-1) ?? ids?.[0]?.length;
  if (!Number.isFinite(count)) throw new Error('The tokenizer did not return a token count.');
  return count;
}
