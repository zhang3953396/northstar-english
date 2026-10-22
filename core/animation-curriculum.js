// Episode progress is practice of a source context, never vocabulary mastery.
function getAnimationLibrary() {
  return typeof window === 'undefined' ? null : window.NORTHSTAR_ANIMATION_LIBRARY || null;
}

function getAnimationEpisodes(library = getAnimationLibrary()) {
  if (!library?.series_episodes) return [];
  const ids = [library.priority_series, ...library.sources.map(source => source.id).filter(id => id !== library.priority_series)];
  return ids.flatMap(id => library.series_episodes[id] || []);
}

function getAnimationContextIndex(library = getAnimationLibrary()) {
  if (!library.context_index) library.context_index = new Map(getAnimationEpisodes(library)
    .flatMap(episode => episode.words).map(word => [word.context_id, word]));
  return library.context_index;
}

function makeAnimationTask(library, date, words, completed, legacyListKey = '') {
  const ids = words.map(word => word.context_id);
  const first = words.find(word => !completed.has(word.context_id)) || words[0];
  return {
    id: library.curriculum_version + ':' + date + ':' + ids.join('|'), date,
    series_id: first.series_id, episode_id: first.episode_id,
    episode_number: first.episode_number, episode_title: first.episode,
    context_ids: ids, new_context_ids: ids.filter(id => !completed.has(id)),
    completed_modes: [], legacy_list_key: legacyListKey
  };
}

function migrateAnimationCurriculum(data, library, today) {
  const schedule = data.schedule;
  if (schedule.animation_curriculum?.version === library.curriculum_version) return false;
  const index = getAnimationContextIndex(library);
  const completed = new Set();
  const wasAnimation = schedule.animation_library_version === library.version;
  // Old days record assignments, not completion. Only explicit mode/session evidence can migrate.
  if (wasAnimation) for (const assignment of schedule.animation_days || []) {
    const day = getLearningDay(data, assignment.date);
    if (!day) continue;
    const candidates = (assignment.words || []).map(key => library.series_words[assignment.series_id]?.find(word => word.english === key)).filter(Boolean);
    const listening = (day.listening || []).find(session => session.completed_at
      && session.words.length === candidates.length && candidates.every(word => session.words.some(record =>
        getVocabularyKey(record.english) === word.english && record.example === word.example)));
    // A day's old reward may belong to the pre-replacement library. It cannot prove this task finished.
    const vocabulary = day.modes.includes('vocabulary') && schedule.today_completed
      && schedule.last_select_date === assignment.date && schedule.last_learn_date === assignment.date
      && candidates.length === schedule.today_words.length
      && candidates.every((word, i) => word.english === schedule.today_words[i]
        && schedule.today_word_contexts?.[i]?.example === word.example);
    if (vocabulary || listening) candidates.forEach(word => completed.add(word.context_id));
  }
  if (schedule.animation_curriculum) schedule.previous_animation_curriculum = schedule.animation_curriculum;
  schedule.animation_curriculum = { version: library.curriculum_version, completed_context_ids: [...completed] };
  // Preserve a genuine current task and its resume position. Do not re-award or restart it on upgrade.
  const current = wasAnimation ? (schedule.today_word_contexts || []).map(word => {
    const id = word.context_id || `${word.series_id}:p${word.source_page}:n${word.source_number}`;
    const candidate = index.get(id);
    return candidate?.english === word.english && candidate.example === word.example ? candidate : null;
  }) : [];
  if (schedule.last_select_date === today && current.length === schedule.today_words.length
      && current.length && current.every((word, i) => word && word.series_id === library.priority_series
        && word.english === schedule.today_words[i])) {
    const key = data.settings.listen_first_list_key || '';
    const oldSession = getLearningDay(data, today)?.listening?.find(session => session.list_key === key);
    const compatible = oldSession?.words.length === current.length && current.every(word => oldSession.words.some(record =>
      getVocabularyKey(record.english) === word.english && record.example === word.example));
    schedule.today_word_contexts = current;
    schedule.today_animation_task = makeAnimationTask(library, today, current, completed, compatible ? key : '');
    if (compatible && oldSession.completed_at) schedule.today_animation_task.completed_modes.push('listen-first');
    if (schedule.today_completed && schedule.last_learn_date === today
        && getLearningDay(data, today)?.modes.includes('vocabulary')) {
      schedule.today_animation_task.completed_modes.push('vocabulary');
    }
  } else {
    const snapshot = { date: schedule.last_select_date, words: [...schedule.today_words],
      contexts: schedule.today_word_contexts || [], progress: schedule.today_progress,
      resume_word: schedule.today_resume_word, results: schedule.today_results || [], completed: schedule.today_completed,
      listening_resume: { list_key: data.settings.listen_first_list_key,
        phase: data.settings.listen_first_phase, progress: data.settings.listen_first_progress } };
    if (!schedule.replaced_daily_task) schedule.replaced_daily_task = snapshot;
    else if (snapshot.words.length) (schedule.replaced_daily_tasks ||= []).push(snapshot);
    schedule.today_words = [];
    schedule.today_word_contexts = [];
    schedule.last_select_date = '';
  }
  schedule.animation_library_version = library.version;
  return true;
}

// Called inside the same atomic write as mode completion/rewards; a failed save cannot advance episodes.
function recordAnimationTaskCompletion(data, date, mode) {
  const library = getAnimationLibrary();
  const schedule = data.schedule;
  const task = schedule.today_animation_task;
  const state = schedule.animation_curriculum;
  if (!library || state?.version !== library.curriculum_version || task?.date !== date
      || schedule.last_select_date !== date || task.context_ids.length !== schedule.today_words.length) return;
  const index = getAnimationContextIndex(library);
  if (!task.context_ids.every((id, i) => index.get(id)?.english === schedule.today_words[i])) return;
  const completed = new Set(state.completed_context_ids);
  task.context_ids.forEach(id => completed.add(id));
  state.completed_context_ids = [...completed];
  if (!task.completed_modes.includes(mode)) task.completed_modes.push(mode);
  const day = getLearningDay(data, date, true);
  const records = day.animation_tasks ||= [];
  let record = records.find(item => item.task_id === task.id);
  if (!record) {
    record = { task_id: task.id, series_id: task.series_id, episode_id: task.episode_id,
      context_ids: [...task.context_ids], modes: [] };
    records.push(record);
  }
  if (!record.modes.includes(mode)) record.modes.push(mode);
}

function getAnimationTaskLabel(data) {
  const task = data.schedule.today_animation_task;
  return task ? `第 ${task.episode_number} 集 · 按集续练` : '';
}

async function prepareAnimationWords(data, today) {
  const library = getAnimationLibrary();
  if (!library?.series_episodes) return false;
  const schedule = data.schedule;
  const migrated = migrateAnimationCurriculum(data, library, today);
  if (schedule.last_select_date === today && schedule.today_words.length) {
    if (migrated) await saveData(data);
    return true;
  }
  const episodes = getAnimationEpisodes(library);
  const completed = new Set(schedule.animation_curriculum.completed_context_ids);
  const episode = episodes.find(item => item.words.some(word => word.daily_eligible && !completed.has(word.context_id)))
    || episodes[episodes.length - 1];
  const pending = episode.words.filter(word => word.daily_eligible && !completed.has(word.context_id));
  const pendingKeys = new Set(pending.map(word => word.english));
  const practiced = episode.words.filter(word => word.daily_eligible && completed.has(word.context_id));
  const isDue = word => data.mistakes.some(item => item.english === word.english && !item.resolved)
    || data.words.some(item => item.english === word.english && item.is_learned && item.next_review <= today);
  const reviews = practiced.filter(word => !pendingKeys.has(word.english) && isDue(word)).slice(0, 2);
  const chosen = [], used = new Set();
  function add(words, limit = 10) {
    for (const word of words) {
      if (chosen.length >= limit) break;
      if (used.has(word.english)) continue;
      chosen.push(word); used.add(word.english);
    }
  }
  add(pending, 10 - reviews.length);
  add(reviews);
  // End-of-episode shortfall is a replay of practiced contexts, never a peek at an unpracticed episode/book.
  add(practiced);
  add(episodes.flatMap(item => item.words).filter(word => word.daily_eligible
    && word.series_id === episode.words[0].series_id && completed.has(word.context_id)));
  add(episodes.flatMap(item => item.words).filter(word => word.daily_eligible && completed.has(word.context_id)));
  if (chosen.length !== 10) throw new Error('本集及已练内容不足 10 个不同词，请检查课程资料');
  const tracked = new Set(data.words.map(word => word.english));
  const newCount = chosen.filter(word => !tracked.has(word.english)).length;
  for (const word of chosen) if (!tracked.has(word.english)) {
    data.words.push({ ...word, error_count: 0, correct_count: 0, consecutive_correct: 0,
      last_seen: '', next_review: today, review_stage: 0, is_learned: false, is_new: true });
    tracked.add(word.english);
  }
  schedule.previous_daily_words = [...schedule.today_words];
  schedule.today_words = chosen.map(word => word.english);
  schedule.today_word_contexts = chosen;
  schedule.today_animation_task = makeAnimationTask(library, today, chosen, completed);
  schedule.today_content_id = library.curriculum_version + ':' + episode.id;
  schedule.today_new_count = newCount;
  schedule.today_review_count = 10 - newCount;
  Object.assign(schedule, { today_completed: false, current_step: 0, today_progress: 0,
    today_resume_word: '', today_results: [], last_select_date: today });
  schedule.animation_days = [...(schedule.animation_days || []), { date: today,
    series_id: episode.words[0].series_id, episode_id: episode.id,
    words: [...schedule.today_words], context_ids: [...schedule.today_animation_task.context_ids] }];
  await saveData(data);
  return true;
}
