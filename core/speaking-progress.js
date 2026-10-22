// Local, source-context-scoped speaking gates. No audio, raw response or request secrets are saved.
const SpeakingProgress = {
  normalize(text) {
    return String(text || '').toLowerCase().replace(/[^a-z'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  },
  key(word) {
    return word.context_id || this.normalize(word.word || word.english) + '|' + this.normalize(word.example || word.word || word.english);
  },
  inTask(data, word) {
    if (!(data.schedule.today_words || []).some(key => this.normalize(key) === this.normalize(word.english || word.word))) return false;
    return !word.context_id || (data.schedule.today_word_contexts || []).some(item => item.context_id === word.context_id && item.example === word.example);
  },
  ensure(data, words, date) {
    if (data.schedule.last_select_date !== date) return false;
    if (data.schedule.speaking_progress?.version === 1 && data.schedule.speaking_progress.date === date
      && data.schedule.speaking_progress.lessons && typeof data.schedule.speaking_progress.lessons === 'object'
      && !Array.isArray(data.schedule.speaking_progress.lessons)) return false;
    const store = { version: 1, date, lessons: {} };
    // Upgrade only exact, passed targets from this date. A word pass cannot prove a different sentence passed.
    const attempts = (data.speaking?.attempts || []).filter(item => item.date === date && item.passed === true);
    for (const word of words) {
      if (!this.inTask(data, word)) continue;
      const target = this.normalize(word.word || word.english);
      const sentence = this.normalize(word.example || target);
      const wordPass = attempts.find(item => item.target === target);
      if (!wordPass) continue;
      const sentencePass = sentence === target || attempts.some(item => item.target === sentence
        && Number.isFinite(Number(wordPass.at)) && Number.isFinite(Number(item.at)) && Number(item.at) >= Number(wordPass.at));
      store.lessons[this.key(word)] = { word_target: target, sentence_target: sentence,
        word_passed: true, sentence_passed: sentencePass, word_attempts: 0, sentence_attempts: 0,
        latest: null, recovered_from: 'exact-passed-targets' };
    }
    data.schedule.speaking_progress = store;
    return true;
  },
  get(data, word, date) {
    const store = data?.schedule?.speaking_progress;
    if (!word || store?.date !== date || data.schedule.last_select_date !== date || !this.inTask(data, word)) return null;
    const entry = store.lessons?.[this.key(word)];
    return entry?.word_target === this.normalize(word.word || word.english)
      && entry.sentence_target === this.normalize(word.example || word.word || word.english) ? entry : null;
  },
  result(result = {}) {
    const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    return {
      score: number(result.score), accuracy: number(result.accuracy), completion: number(result.completion),
      words: (result.words || []).slice(0, 128).map(word => ({
        word: String(word.word || ''), reference: String(word.reference || ''),
        accuracy: number(word.accuracy), accuracyProvided: word.accuracyProvided !== false && number(word.accuracy) !== null,
        completion: number(word.completion), matchTag: number(word.matchTag),
        phonemes: (word.phonemes || []).map(phone => ({ phone: String(phone.phone || ''),
          accuracy: number(phone.accuracy), completion: number(phone.completion) }))
      }))
    };
  },
  set(data, word, date, state) {
    if (data.schedule.last_select_date !== date || !this.inTask(data, word)) return;
    this.ensure(data, [word], date);
    const previous = this.get(data, word, date);
    const entry = {
      ...(previous || {}),
      word_target: this.normalize(word.word || word.english), sentence_target: this.normalize(word.example || word.word || word.english),
      word_passed: !!state.word_passed, sentence_passed: !!state.sentence_passed,
      word_attempts: Number(state.word_attempts) || 0, sentence_attempts: Number(state.sentence_attempts) || 0,
      latest: { target: String(state.target || ''), mode: state.mode, passed: !!state.passed, result: this.result(state.result) }
    };
    if (state.rescue_attempts && typeof state.rescue_attempts === 'object' && !Array.isArray(state.rescue_attempts)) {
      entry.rescue_attempts = Object.fromEntries(Object.entries(state.rescue_attempts)
        .map(([target, count]) => [this.normalize(target), Number(count)])
        .filter(([target, count]) => target && Number.isSafeInteger(count) && count >= 0));
    }
    // Gate release after repeated low scores is not evidence that a sentence
    // actually passed. Only the explicit result of this exact sentence counts.
    if (state.mode === 'sentence' && state.passed === true
      && this.normalize(state.target) === entry.sentence_target) {
      entry.sentence_evidence = { at: Date.now(), target: String(state.target), result: this.result(state.result) };
    }
    data.schedule.speaking_progress.lessons[this.key(word)] = entry;
  },
  defer(data, word, date, options = {}) {
    if (!word || data.schedule.last_select_date !== date || !this.inTask(data, word)) return null;
    this.ensure(data, [word], date);
    const previous = this.get(data, word, date);
    const entry = previous || {
      word_target: this.normalize(word.word || word.english),
      sentence_target: this.normalize(word.example || word.word || word.english),
      word_passed: false, sentence_passed: false, word_attempts: 0, sentence_attempts: 0, latest: null
    };
    const deferred = {
      at: Date.now(), target: String(options.target || word.example || word.word || word.english || ''),
      mode: options.mode === 'sentence' ? 'sentence' : 'word',
      reason: String(options.reason || 'user-continue').slice(0, 120)
    };
    data.schedule.speaking_progress.lessons[this.key(word)] = { ...entry, deferred };
    return deferred;
  },
  sharedSentence(data, word, date) {
    if (!word || data?.schedule?.last_select_date !== date || !this.inTask(data, word)) return null;
    const store = data.schedule.speaking_progress;
    if (store?.version !== 1 || store.date !== date || !word.series_id || !word.episode_id) return null;
    const sentence = this.normalize(word.example);
    if (!sentence) return null;
    for (const candidate of data.schedule.today_word_contexts || []) {
      if (this.key(candidate) === this.key(word) || candidate.series_id !== word.series_id
        || candidate.episode_id !== word.episode_id || this.normalize(candidate.example) !== sentence) continue;
      if (word.episode_number != null && candidate.episode_number !== word.episode_number) continue;
      const entry = this.get(data, candidate, date);
      if (!entry) continue;
      const evidence = entry.sentence_evidence
        && this.normalize(entry.sentence_evidence.target) === sentence
        ? entry.sentence_evidence
        : entry.latest?.mode === 'sentence' && entry.latest.passed === true
          && this.normalize(entry.latest.target) === sentence ? entry.latest : null;
      if (!evidence) continue;
      return { target: String(word.example), result: this.result(evidence.result), from_context_id: candidate.context_id || '' };
    }
    return null;
  }
};
