'use strict';

(function () {
  const SAMPLE_RATE = 16000;
  const CHUNK_BYTES = 1280;
  const MAX_MS = 7000;
  const MIN_MS = 900;
  const SILENCE_MS = 900;
  const NO_VOICE_MS = 7000;
  const VOICE_LEVEL = 0.006;
  const WARMUP_BUFFERS = 3;
  let microphoneStream = null;

  function setAudioSession(type) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = type;
    } catch (_) {}
  }

  function parkMicrophone() {
    if (microphoneStream) {
      microphoneStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }
    setAudioSession('playback');
  }

  function releaseMicrophone() {
    if (microphoneStream) microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
    setAudioSession('playback');
  }

  async function getMicrophone({ fresh = false } = {}) {
    setAudioSession('auto');
    const live = microphoneStream && microphoneStream.getAudioTracks().some(track => track.readyState === 'live');
    if (fresh || !live) {
      releaseMicrophone();
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    microphoneStream.getAudioTracks().forEach(track => { track.enabled = true; });
    setAudioSession('play-and-record');
    return microphoneStream;
  }

  if (typeof window !== 'undefined') window.addEventListener('pagehide', releaseMicrophone);
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', releaseMicrophone);
  }

  function downsample(input, fromRate) {
    if (!Number.isFinite(fromRate) || fromRate <= 0) throw new Error('录音采样率无效，请重新录一次。');
    if (Math.abs(fromRate - SAMPLE_RATE) < 1) return input;
    const ratio = fromRate / SAMPLE_RATE;
    const output = new Float32Array(Math.round(input.length / ratio));
    for (let i = 0; i < output.length; i++) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const mix = position - left;
      output[i] = (input[left] || 0) * (1 - mix) + (input[right] || 0) * mix;
    }
    return output;
  }

  function getRecordingTiming(sampleCount, durationMs) {
    const pcmDurationMs = sampleCount / SAMPLE_RATE * 1000;
    const durationRatio = durationMs > 0 ? pcmDurationMs / durationMs : 1;
    return {
      pcmDurationMs: Math.round(pcmDurationMs),
      durationRatio
    };
  }

  function toPcm16(samples) {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
  }

  function pcmToWav(pcm) {
    const dataBytes = pcm.byteLength;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, dataBytes, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
    const blob = new Blob([buffer], { type: 'audio/wav' });
    return { blob, url: URL.createObjectURL(blob) };
  }

  function concatFloat(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function parseResult(message) {
    let result = message.result;
    if (typeof result === 'string') {
      const score = numberAfter(result, 'SuggestedScore');
      const accuracies = Array.from(result.matchAll(/PronAccuracy:([-0-9.]+)/g))
        .map(match => Number(match[1]))
        .filter(value => value >= 0);
      const completion = numberAfter(result, 'PronCompletion');
      return {
        score,
        accuracy: accuracies.length ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length : 0,
        completion,
        words: parseWords(result),
        raw: result
      };
    }
    if (result && typeof result === 'object') {
      const score = Number(result.SuggestedScore ?? result.suggested_score ?? 0);
      return {
        score,
        accuracy: Number(result.PronAccuracy ?? result.pron_accuracy ?? score),
        completion: Number(result.PronCompletion ?? result.pron_completion ?? (score > 0 ? 1 : 0)),
        fluency: Number(result.PronFluency ?? result.pron_fluency ?? 0),
        words: normalizeWords(result.Words || result.words || []),
        raw: JSON.stringify(result)
      };
    }
    return {};
  }

  function numberAfter(text, key) {
    const value = text.match(new RegExp(key + ':([-0-9.]+)'))?.[1];
    return value == null ? 0 : Number(value);
  }

  function parseWords(raw) {
    const wordsText = raw.match(/Words:\[(.*?)]\s*SentenceId:/)?.[1] || '';
    return wordsText
      .split(/(?=\{?Mbtm:)/)
      .map(part => {
        const word = part.match(/\bWord:([^\s}\]]+)/)?.[1] || '';
        const reference = part.match(/\bReferenceWord:([^\s}\]]+)/)?.[1] || '';
        const accuracy = numberAfter(part, 'PronAccuracy');
        const completion = numberAfter(part, 'PronCompletion');
        const matchTag = numberAfter(part, 'MatchTag');
        const begin = numberAfter(part, 'MemBeginTime');
        const end = numberAfter(part, 'MemEndTime');
        return { word, reference, accuracy, accuracyProvided: /\bPronAccuracy:([-0-9.]+)/.test(part), completion, matchTag, begin, end };
      })
      .filter(item => item.word || item.reference || item.accuracy);
  }

  function normalizeWords(words) {
    return words.map(item => {
      const accuracy = Number(item.PronAccuracy ?? item.pron_accuracy ?? 0);
      return {
        word: item.Word || item.word || '',
        reference: item.ReferenceWord || item.reference_word || item.reference || '',
        accuracy,
        accuracyProvided: (item.PronAccuracy ?? item.pron_accuracy) != null && Number.isFinite(accuracy),
        completion: Number(item.PronCompletion ?? item.pron_completion ?? (accuracy > 0 ? 1 : 0)),
        matchTag: Number(item.MatchTag ?? item.match_tag ?? item.matchTag ?? 0),
        begin: Number(item.MemBeginTime ?? item.mem_begin_time ?? item.begin ?? 0),
        end: Number(item.MemEndTime ?? item.mem_end_time ?? item.end ?? 0),
        phonemes: normalizePhonemes(item.Phonemes || item.phonemes || [])
      };
    });
  }

  function normalizePhonemes(phonemes) {
    return phonemes.map(item => {
      const accuracy = Number(item.PronAccuracy ?? item.pron_accuracy ?? 0);
      return {
        phone: item.Phone || item.phone || '',
        accuracy,
        completion: Number(item.PronCompletion ?? item.pron_completion ?? (accuracy > 0 ? 1 : 0)),
        begin: Number(item.MemBeginTime ?? item.mem_begin_time ?? 0),
        end: Number(item.MemEndTime ?? item.mem_end_time ?? 0)
      };
    });
  }

  function sendPcm(ws, pcm) {
    const bytes = new Uint8Array(pcm.buffer);
    let offset = 0;
    let chunks = 0;
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(timer);
        return;
      }
      if (offset >= bytes.length) {
        clearInterval(timer);
        ws.send(JSON.stringify({ type: 'end' }));
        return;
      }
      ws.send(bytes.slice(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
      chunks++;
    }, 40);
    return () => chunks;
  }

  function sendPcmOnce(ws, pcm) {
    ws.send(new Uint8Array(pcm.buffer));
    ws.send(JSON.stringify({ type: 'end' }));
    return 1;
  }

  function shouldUseMediaRecorder(onLevel) {
    const isIPad = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return Boolean(onLevel && isIPad && window.MediaRecorder);
  }

  function readBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  function decodeAudioData(context, data) {
    return new Promise((resolve, reject) => {
      const result = context.decodeAudioData(data, resolve, reject);
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    });
  }

  async function decodeRecordedBlob(blob) {
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = OfflineCtx ? new OfflineCtx(1, 1, SAMPLE_RATE) : new AudioCtx();
    const audio = await decodeAudioData(context, await readBlob(blob));
    return {
      samples: new Float32Array(audio.getChannelData(0)),
      sampleRate: Number(audio.sampleRate)
    };
  }

  async function recordMediaPcm({ onLevel, maxMs }) {
    const stream = await getMicrophone();
    await new Promise(resolve => setTimeout(resolve, 500));
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    let blob;
    try {
      blob = await new Promise((resolve, reject) => {
        let timer = 0;
        recorder.ondataavailable = event => {
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onerror = event => {
          clearTimeout(timer);
          reject(event.error || new Error('iPad 录音失败，请重新读一次。'));
        };
        recorder.onstop = () => {
          clearTimeout(timer);
          const type = recorder.mimeType || chunks[0]?.type || 'audio/mp4';
          resolve(new Blob(chunks, { type }));
        };
        recorder.start();
        if (onLevel) onLevel({ heardVoice: false, ready: true, metered: false });
        timer = setTimeout(() => recorder.stop(), maxMs);
      });
    } finally {
      parkMicrophone();
    }
    if (!blob.size) throw new Error('这次没有录到声音，请重新读一次。');
    const decoded = await decodeRecordedBlob(blob);
    const pcm = toPcm16(downsample(decoded.samples, decoded.sampleRate));
    let maxLevel = 0;
    for (let offset = 0; offset < decoded.samples.length; offset += 4096) {
      const chunk = decoded.samples.subarray(offset, Math.min(offset + 4096, decoded.samples.length));
      const level = Math.sqrt(chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length);
      maxLevel = Math.max(maxLevel, level);
    }
    const durationMs = decoded.samples.length / decoded.sampleRate * 1000;
    const timing = getRecordingTiming(pcm.length, durationMs);
    const wav = pcmToWav(pcm);
    return {
      pcm,
      replayUrl: wav.url,
      heardVoice: maxLevel > VOICE_LEVEL,
      maxLevel,
      bytes: pcm.byteLength,
      plannedChunks: Math.ceil(pcm.byteLength / CHUNK_BYTES),
      durationMs: Math.round(durationMs),
      pcmDurationMs: timing.pcmDurationMs,
      durationRatio: timing.durationRatio,
      captureSampleRate: decoded.sampleRate,
      recordingMethod: 'media-recorder'
    };
  }

  async function recordPcm(options = {}) {
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      throw new Error('iPad 跟读需要从安全地址打开，请使用 HTTPS。');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('这个浏览器暂时不能使用麦克风，请检查 Safari 权限。');
    }
    const onLevel = typeof options === 'function' ? options : options.onLevel;
    const silenceMs = typeof options === 'function' ? SILENCE_MS : (options.silenceMs ?? SILENCE_MS);
    const maxMs = typeof options === 'function' ? MAX_MS : (options.maxMs ?? MAX_MS);
    if (shouldUseMediaRecorder(onLevel)) return recordMediaPcm({ onLevel, maxMs });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      releaseMicrophone();
      throw new Error('这个浏览器暂时不能处理录音，请升级 Safari。');
    }
    const context = new AudioCtx();
    if (context.state === 'suspended') await context.resume();
    const contextSampleRate = Number(context.sampleRate);
    let stream;
    try {
      // 桌面端每次跟读重新取浏览器当前输入。外接显示器/麦克风切换后，
      // 旧轨道可能仍是 live，却只输出静音数据。
      stream = await getMicrophone({ fresh: true });
    } catch (error) {
      await context.close();
      throw error;
    }
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    let warmupBuffers = WARMUP_BUFFERS;
    let inputSampleRate = 0;
    let startedAt = 0;
    let heardVoice = false;
    let maxLevel = 0;
    let quietSince = 0;
    let done = false;
    let finish = null;
    source.connect(processor);
    processor.connect(context.destination);
    const wait = new Promise(resolve => { finish = resolve; });
    processor.onaudioprocess = e => {
      if (done) return;
      const input = e.inputBuffer.getChannelData(0);
      const bufferSampleRate = Number(e.inputBuffer.sampleRate);
      if (Number.isFinite(bufferSampleRate) && bufferSampleRate > 0) inputSampleRate = bufferSampleRate;
      if (warmupBuffers > 0) {
        warmupBuffers--;
        if (warmupBuffers === 0) {
          startedAt = Date.now();
          if (onLevel) onLevel({ level: 0, maxLevel, heardVoice, ready: true });
        }
        return;
      }
      chunks.push(new Float32Array(input));
      const level = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0) / input.length);
      maxLevel = Math.max(maxLevel, level);
      if (onLevel) onLevel({ level, maxLevel, heardVoice });
      const now = Date.now();
      if (level > VOICE_LEVEL) {
        heardVoice = true;
        quietSince = 0;
      } else if (!heardVoice && now - startedAt > NO_VOICE_MS) {
        done = true;
        finish();
      } else if (heardVoice && now - startedAt > MIN_MS) {
        quietSince = quietSince || now;
        if (now - quietSince > silenceMs) {
          done = true;
          finish();
        }
      }
    };
    const timeout = setTimeout(() => {
      done = true;
      finish();
    }, maxMs + 1500);
    await wait;
    const endedAt = Date.now();
    clearTimeout(timeout);
    processor.disconnect();
    source.disconnect();
    await context.close();
    parkMicrophone();
    const durationMs = startedAt ? endedAt - startedAt : 0;
    const samples = concatFloat(chunks);
    const captureSampleRate = inputSampleRate || contextSampleRate;
    const pcm = toPcm16(downsample(samples, captureSampleRate));
    const timing = getRecordingTiming(pcm.length, durationMs);
    const recording = {
      pcm,
      heardVoice,
      maxLevel,
      bytes: pcm.byteLength,
      plannedChunks: Math.ceil(pcm.byteLength / CHUNK_BYTES),
      durationMs,
      pcmDurationMs: timing.pcmDurationMs,
      durationRatio: timing.durationRatio,
      captureSampleRate,
      contextSampleRate,
      inputSampleRate
    };
    const wav = pcmToWav(pcm);
    return Object.assign(recording, {
      replayUrl: wav.url,
    });
  }

  async function assess(refText, options = {}) {
    const cleanText = String(refText || '').replace(/[^a-zA-Z'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const evalMode = options.evalMode ?? (cleanText.includes(' ') ? 1 : 0);
    const recordingOptions = Object.assign({}, options, {
      maxMs: options.maxMs ?? (evalMode === 1 ? 6000 : 3000)
    });
    const [{ url, debug }, recording] = await Promise.all([
      fetch('/api/tencent-soe-url?ref_text=' + encodeURIComponent(cleanText) + '&eval_mode=' + evalMode + '&rec_mode=1')
        .then(async response => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || '评分服务暂时不可用');
          return body;
        }),
      recordPcm(recordingOptions)
    ]);
    if (!url) throw new Error('腾讯智聆签名失败');
    if (!recording.heardVoice) {
      const err = new Error('没有检测到麦克风声音，请靠近一点或检查输入设备。最大音量 ' + Math.round(recording.maxLevel * 1000));
      err.recording = recording;
      throw err;
    }

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let last = null;
      let sentChunks = 0;
      let sentTimer = null;
      ws.onopen = () => {};
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.code) {
          reject(new Error(message.message || '腾讯智聆评测失败'));
          ws.close();
          return;
        }
        if (message.result) last = parseResult(message);
        if (message.final === 1) {
          if (sentTimer) clearInterval(sentTimer);
          resolve(Object.assign(last || {}, { request: debug, recording: Object.assign(recording, { sentChunks: sentChunks || recording.plannedChunks }) }));
          ws.close();
        } else if (message.message === 'success' && !message.result) {
          if (debug?.rec_mode === '1') {
            sentChunks = sendPcmOnce(ws, recording.pcm);
          } else {
            const getSentChunks = sendPcm(ws, recording.pcm);
            sentTimer = setInterval(() => {
              sentChunks = getSentChunks();
              if (ws.readyState !== WebSocket.OPEN) clearInterval(sentTimer);
            }, 80);
          }
        }
      };
      ws.onerror = () => reject(new Error('腾讯智聆连接失败'));
    });
  }

  globalThis.TencentSOE = { assess, record: recordPcm, parseResult, ready: true };
})();
