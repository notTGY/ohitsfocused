/* TEST DOUBLE ONLY. No model weights, network calls or actual S1 inference. */
export const env = {};
export class TextStreamer {
  constructor(_tokenizer, options) { this.options = options; this.prompt = true; }
  put(value) {
    if (this.prompt) { this.prompt = false; return; }
    this.options.token_callback_function?.(value[0]);
  }
  end() {}
}
export async function pipeline(task, model, opts) {
  if (task !== 'text-generation' || model !== 'onnx-community/s1-mini-ONNX' || opts.device !== 'webgpu' || opts.dtype !== 'q4f16' || !/^[a-f0-9]{40}$/.test(opts.revision)) throw new Error('Incorrect S1 model configuration');
  opts.progress_callback({status:'progress',file:'model_q4f16.onnx_data',loaded:100,total:200});
  opts.progress_callback({status:'progress_total',loaded:200,total:400,progress:50});
  const pipe = async (messages, config) => {
    if (config.do_sample !== false || config.tokenizer_encode_kwargs?.enable_thinking !== false) throw new Error('Thinking/sampling was not disabled');
    if (messages[0].role !== 'system' || !messages[0].content.startsWith('You are a text normalizer')) throw new Error('Missing system prompt');
    if (!messages[1].content.startsWith('[Styling: semi-formal] [Structure: prose] [Context: general]\n')) throw new Error('Missing trained control line');
    const raw = messages[1].content.split('\n').slice(1).join('\n');
    if (raw.split(/\s+/).length > 700) throw new Error('Cleanup input too long');
    if (raw.includes('FAIL_TEST')) throw new Error('Simulated generation failure');
    const budget = Math.min(1024, Math.max(64, Math.ceil(raw.split(/\s+/).length * 1.3) + 32));
    if (config.max_new_tokens !== budget) throw new Error('Incorrect output token budget');
    config.streamer.put([[1n,2n,3n]]); // prompt
    let text;
    if (raw.includes('TRUNCATE_TEST')) {
      for (let n=0; n<config.max_new_tokens; n++) config.streamer.put([[42n]]);
      text = 'Incomplete output…';
    } else {
      config.streamer.put([[42n]]); config.streamer.put([[151645n]]);
      text = raw === 'um' ? '' : raw.replace(/^so um /, '').replace(/friday no wait thursday/, 'Thursday');
    }
    config.streamer.end();
    return [{generated_text: [...messages, {role:'assistant', content:text}]}];
  };
  pipe.tokenizer = text => ({input_ids:{size:text.trim().split(/\s+/).length}});
  pipe.tokenizer.eos_token_id = 151645;
  pipe.model = {generation_config:{eos_token_id:151645}};
  return pipe;
}
