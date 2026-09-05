/* TEST DOUBLE ONLY. Never imported by the app or included in its build.
   Exercises worker wiring and real browser audio extraction, not model accuracy. */
export const env = { backends: { onnx: { wasm: {} } } };
export class WhisperTextStreamer { constructor(_tokenizer, options) { Object.assign(this, options); } }
const wait = time => new Promise(resolve => setTimeout(resolve, time));
export async function pipeline(task, model, options) {
  if (task !== 'automatic-speech-recognition' || options.device !== 'wasm' || options.dtype !== 'q8') throw new Error('Incorrect pipeline options');
  for (const file of ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx']) {
    options.progress_callback({ status: 'progress', file, loaded: 500, total: 1000 });
    await wait(100);
    options.progress_callback({ status: 'done', file });
  }
  await wait(150);
  const pipe = async (audio, config) => {
    if (!(audio instanceof Float32Array) || audio.length < 80000 || audio.length > 120000) throw new Error('Audio was not decoded at 16 kHz');
    if (config.chunk_length_s !== 30 || config.stride_length_s !== 5 || config.return_timestamps !== true) throw new Error('Incorrect chunk options');
    if (model.endsWith('.en') && ('language' in config || 'task' in config)) throw new Error('Language/task sent to an English-only model');
    if (!model.endsWith('.en') && (!config.language || config.task !== 'transcribe')) throw new Error('Missing multilingual task/language');
    if (config.language === 'de') throw new Error('Intentional inference failure');
    const french = config.language === 'fr';
    const a = french ? 'Les petits moments méritent un peu plus d’attention.' : 'Small moments deserve a little more attention.';
    const b = french ? 'Ceci est un test de transcription vidéo locale.' : 'This is a test of local video transcription.';
    config.streamer.callback_function(a);
    await wait(550);
    config.streamer.callback_function(' ' + b);
    await wait(550);
    config.streamer.on_finalize();
    if (config.language === 'it') return { text: '', chunks: [] };
    if (config.language === 'ar') return { text: '<img src=x onerror=alert(1)>', chunks: [{text:'<img src=x onerror=alert(1)>',timestamp:[0,6]}] };
    return { text: a + ' ' + b, chunks: [{text:a,timestamp:[0,2.5]},{text:b,timestamp:[2.5,null]}] };
  };
  pipe.tokenizer = {};
  pipe.dispose = async () => {};
  return pipe;
}
