// Actual vocabulary checks. Missing evidence is unknown, never a wrong answer.
const LearningResults = {
  key(value) {
    return getVocabularyKey(value);
  },
  // Current daily practice checks meaning and listening, not spelling/building.
  // Old build attempts stay stored; removing a requirement is not a fake pass.
  requiredStages() {
    return ['choice', 'match', 'listen'];
  },
  activeHadWrong(saved) {
    if (saved.assessment_version !== 2) return !!saved.hadWrong;
    const failed = (saved.attempts || []).filter(attempt => attempt.correct === false);
    if (this.requiredStages().some(stage => saved.checks?.[stage]?.correct === false)
      || failed.some(attempt => attempt.stage !== 'sound-build')) return true;
    // Only an explicitly recorded, retired build failure can be discounted.
    // An unexplained historical wrong flag remains a real/unknown old fact.
    return failed.some(attempt => attempt.stage === 'sound-build') ? false : !!saved.hadWrong;
  },
  taskKey(data) {
    return JSON.stringify([data.schedule.last_select_date,data.schedule.today_words,
      (data.schedule.today_word_contexts||[]).map(word=>[word.context_id,word.example])]);
  },
  groupMarker(data,date,start,next) {
    return {version:1,date,task_key:this.taskKey(data),start,next,id:date+'-'+start+'-'+Date.now()+'-'+Math.random().toString(36).slice(2)};
  },
  groupResume(data,date) {
    const group=data.schedule.vocabulary_group,keys=data.schedule.today_words||[];
    if(!group||group.version!==1||group.date!==date||data.schedule.last_select_date!==date||group.task_key!==this.taskKey(data)
      ||!Number.isInteger(group.start)||!Number.isInteger(group.next)||group.start<0||group.next>keys.length||group.next<=group.start||group.next-group.start>5)return null;
    const entries=keys.slice(group.start,group.next).map(english=>{
      const context=(data.schedule.today_word_contexts||[]).find(word=>this.key(word.english||word.word)===this.key(english));
      return (data.schedule.today_results||[]).find(row=>row.date===date&&this.key(row.english)===this.key(english)
        &&(!row.context_id||!context?.context_id||row.context_id===context.context_id));
    });
    const matchedKeys=entries.flatMap((row,index)=>row?.checks?.match?.correct===true&&row.checks.match.group_id===group.id?[keys[group.start+index]]:[]);
    if(matchedKeys.length<entries.length)return {phase:'match',index:group.next-1,spellIndex:group.next,matchedKeys};
    const listenIndex=entries.findIndex(row=>row?.checks?.listen?.completed!==true
      ||row.checks.listen.correct!==true||row.checks.listen.group_id!==group.id);
    if(listenIndex>=0)return {phase:'listen',index:group.next-1,spellIndex:group.next,listenIndex,matchedKeys};
    return {phase:group.next>=keys.length?'summary':'intro',index:group.next,spellIndex:group.next,matchedKeys,clear:true};
  },
  record(data, word, date, correct, value, stage = '') {
    const english = this.key(word.english || word.word);
    if (data.schedule.last_select_date !== date || !(data.schedule.today_words || []).some(key => this.key(key) === english)) {
      throw new Error('学习任务已变化，请回到首页继续当前任务。');
    }
    const rows = data.schedule.today_results || (data.schedule.today_results = []);
    let row = rows.find(item => item.date === date && this.key(item.english) === english
      && (!item.context_id || !word.context_id || item.context_id === word.context_id));
    if (!row) {
      row = { english, chinese: word.chinese || '', date, correct: false, hadWrong: false, attempts: [] };
      rows.push(row);
    }
    row.chinese = word.chinese || row.chinese || '';
    row.context_id = word.context_id || row.context_id || '';
    row.attempts = Array.isArray(row.attempts) ? row.attempts : [];
    const assisted = stage === 'sound-build' && correct === null;
    row.attempts.push({ value: String(value || ''), correct: assisted ? null : !!correct, stage, at: Date.now() });
    row.hadWrong = !!row.hadWrong || (!assisted && !correct);
    row.correct = !row.hadWrong && (assisted ? row.correct === true : !!correct);
    if (stage) {
      row.assessment_version = 2;
      row.requires_sound_build = !!word.requires_sound_build;
      row.checks = row.checks || {};
      row.checks[stage] = { completed: true, correct: assisted ? null : !!correct, at: Date.now() };
      if(assisted)row.checks[stage].assisted=true;
      const group=data.schedule.vocabulary_group;
      if(['match','listen'].includes(stage)&&group?.date===date&&group.task_key===this.taskKey(data))row.checks[stage].group_id=group.id;
    }
    return row;
  },
  rows(data, date, bank = [], fallback = []) {
    const stored = (data.schedule.today_results || []).filter(row => row.date === date);
    return (data.schedule.today_words || []).map(value => {
      const english = this.key(value);
      const context = (data.schedule.today_word_contexts || []).find(word => this.key(word.english || word.word) === english);
      const word = context || bank.find(word => this.key(word.english || word.word) === english) || {};
      const saved = stored.find(row => this.key(row.english) === english
        && (!row.context_id || !context?.context_id || row.context_id === context.context_id));
      const old = fallback.filter(row => this.key(row.wordEnglish) === english);
      if (!saved && !old.length) return { english, chinese: word.chinese || '', correct: false, hadWrong: false, complete: false, status: 'unrecorded' };
      const hadWrong = saved ? this.activeHadWrong(saved) : old.some(row => !row.correct);
      const required = this.requiredStages();
      const complete = saved?.assessment_version === 2
        ? required.every(stage => saved.checks?.[stage]?.completed === true)
        : !!(saved && (saved.correct === true || saved.hadWrong === true || saved.attempts?.length)) || old.length > 0;
      const correct = complete && !hadWrong && (saved?.assessment_version === 2
        ? required.every(stage => saved.checks?.[stage]?.correct === true)
        : saved ? saved.correct === true : old.every(row => row.correct));
      return { english, chinese: saved?.chinese || word.chinese || '', correct, hadWrong, complete,
        status: hadWrong ? 'practice' : correct ? 'correct' : 'unrecorded' };
    });
  }
};
