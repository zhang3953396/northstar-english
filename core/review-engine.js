// review-engine.js — 间隔复习算法 + 每日选词引擎
// SM-0 简化算法：第1天学 → 第2天复习 → 第4天 → 第7天 → 第15天 → 第30天

const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];

function dateStrInChina(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = {};
  parts.forEach(part => { map[part.type] = part.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

function todayStr() {
  return dateStrInChina(new Date());
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateStrInChina(d);
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStrInChina(d);
}

// 计算下次复习日期
function calcNextReview(currentStage, wasCorrect) {
  if (wasCorrect) {
    const nextStage = Math.min(currentStage + 1, REVIEW_INTERVALS.length - 1);
    return { stage: nextStage, date: offsetDate(REVIEW_INTERVALS[nextStage]) };
  } else {
    // 答错回退到阶段0，明天就复习
    return { stage: 0, date: offsetDate(1) };
  }
}

// 拼写判断 + 模糊提示
function checkSpelling(input, correct) {
  input = getVocabularyKey(input).replace(/[.!?]+$/, '');
  correct = getVocabularyKey(correct).replace(/[.!?]+$/, '');

  if (input === correct) {
    return { correct: true, hint: '', distance: 0 };
  }

  const dist = levenshtein(input, correct);

  if (dist === 1) {
    return { correct: false, hint: '就差一点点！再试一次 💪', distance: 1, close: true };
  }

  if (dist === 2) {
    return { correct: false, hint: '很接近了，再看看～', distance: 2, close: true };
  }

  // 显示首字母+长度提示
  const hint = correct[0] + ' _ '.repeat(correct.length - 1) + ' （' + correct.length + '个字母）';
  return { correct: false, hint: hint, distance: dist, close: false };
}

// Levenshtein 编辑距离
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
    }
  }
  return dp[m][n];
}

// 每日选词：6个新词 + 4个复习词
async function selectTodaysWords() {
  const today = todayStr();
  const data = await loadData();

  // 如果今天已经选好了词且未完成，直接返回
  if (data.schedule.today_words.length && data.schedule.last_select_date === today && !data.schedule.today_completed) {
    return data;
  }

  // 如果今天已完成，返回data（不能重新选词）
  if (data.schedule.today_completed && data.schedule.last_learn_date === today) {
    return data;
  }

  // 新的一天：选词
  const learnedKeys = new Set(data.words.filter(w => w.is_learned).map(w => w.english));
  const allWords = WORD_BANK || [];

  // 1. 选复习词：next_review <= today，优先 overdue 和 error_count 高的
  let reviewWords = data.words
    .filter(w => w.next_review <= today && w.is_learned)
    .sort((a, b) => (b.error_count - a.error_count))
    .slice(0, data.settings.new_words_per_day >= 10 ? 4 : data.settings.new_words_per_day >= 8 ? 3 : 2);

  // 2. 选新词：从词库中选未学过的，按 difficulty 升序
  const newCount = data.schedule.today_new_count || (data.settings.daily_goal - reviewWords.length);
  let newWords = [];
  if (newCount > 0) {
    newWords = allWords
      .filter(w => !learnedKeys.has(w.english))
      .sort((a, b) => a.difficulty - b.difficulty)
      .slice(0, newCount);
  }

  // 3. 如果复习词不够4个，用新词补
  if (reviewWords.length < 4 && newWords.length > newCount) {
    const extra = newWords.splice(newCount, Math.min(4 - reviewWords.length, newWords.length - newCount));
    reviewWords = reviewWords.concat(extra.map(w => ({ ...w, is_learned: true, review_stage: 0 })));
  }

  // 4. 给新词创建进度记录（如果还没有）
  for (const nw of newWords) {
    if (!data.words.find(w => w.english === nw.english)) {
      data.words.push({
        ...nw,
        error_count: 0, correct_count: 0, consecutive_correct: 0,
        last_seen: '', next_review: today, review_stage: 0,
        is_learned: false, is_new: true
      });
    }
  }

  // 5. 合并并打乱顺序
  const todayList = [...newWords, ...reviewWords].sort(() => Math.random() - 0.5);
  data.schedule.today_words = todayList.map(w => w.english);
  data.schedule.today_new_count = newWords.length;
  data.schedule.today_review_count = reviewWords.filter(w => w.is_learned && !w.is_new).length;
  data.schedule.today_completed = false;
  data.schedule.current_step = 0;
  data.schedule.last_select_date = today;
  data.schedule.rewards_awarded_date = '';
  if (!data.schedule.streak_start) data.schedule.streak_start = today;

  await saveData(data);
  return data;
}

// 获取今日单词的完整数据
function getTodayWordObjects(data) {
  const contexts = data.schedule.today_word_contexts || [];
  return data.schedule.today_words
    .map(en => {
      const progress = data.words.find(w => w.english === en);
      const context = contexts.find(w => w.english === en);
      const word = context ? { ...progress, ...context } : progress || WORD_BANK.find(w => w.english === en);
      return typeof window !== 'undefined' && window.AnimationMeaningCorrections
        ? window.AnimationMeaningCorrections.apply(word) : word;
    })
    .filter(Boolean);
}

// Display forms such as "Look out!" share the stable progress key "look out".
function getVocabularyKey(value) {
  const key = String(value || '').normalize('NFKC').replace(/’/g, "'").trim().replace(/\s+/g, ' ').toLowerCase();
  return ['mr.', 'mrs.', 'ms.', 'dr.'].includes(key) ? key : key.replace(/[.!?]+$/, '');
}

// Shared pure update so answer evidence and progress can commit in one transaction.
function applyVocabularyAnswer(d, english, correct, wrongAttempt = '') {
  english = getVocabularyKey(english);
  const w = d.words.find(w => w.english === english);
  if (!w) return;
  if (correct) {
    w.correct_count++;
    w.consecutive_correct++;
    w.last_seen = todayStr();
    w.is_learned = true;
    w.is_new = false;
    const { stage, date } = calcNextReview(w.review_stage || 0, true);
    w.review_stage = stage;
    w.next_review = date;
    return;
  }
  w.error_count++;
  w.consecutive_correct = 0;
  w.last_seen = todayStr();
  const { stage, date } = calcNextReview(w.review_stage || 0, false);
  w.review_stage = stage;
  w.next_review = date;
  let m = d.mistakes.find(m => m.english === english);
  if (!m) {
    m = { english, chinese: w.chinese, wrong_attempts: [], last_wrong: '', retry_count: 0, resolved: false };
    d.mistakes.push(m);
  }
  m.wrong_attempts.push({ attempt: wrongAttempt, date: todayStr() });
  m.last_wrong = todayStr();
  m.resolved = false;
}

// 记录正确
async function recordCorrect(english) {
  await atomicUpdate(d => applyVocabularyAnswer(d, english, true));
}

// 记录错误
async function recordIncorrect(english, wrongAttempt) {
  await atomicUpdate(d => applyVocabularyAnswer(d, english, false, wrongAttempt));
}

// 错词本重试成功
async function resolveMistake(english) {
  english = getVocabularyKey(english);
  await atomicUpdate(d => {
    const m = d.mistakes.find(m => m.english === english);
    if (m) { m.retry_count++; m.resolved = true; }
  });
}
