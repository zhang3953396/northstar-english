// rewards.js — 奖励系统：星星/打卡/等级/徽章/宠物/宝箱

const LEVELS = [
  { lv: 1, name: '单词新兵', exp: 0 },
  { lv: 2, name: '拼写小兵', exp: 100 },
  { lv: 3, name: '单词骑士', exp: 300 },
  { lv: 4, name: '记忆队长', exp: 600 },
  { lv: 5, name: '英语小英雄', exp: 1000 }
];

const BADGES = {
  first_perfect: { name: '首次全对', icon: '🎯', desc: '第一次10个词的巩固练习全部答对' },
  streak_3: { name: '小火苗', icon: '🔥', desc: '连续学习3天' },
  streak_7: { name: '学习小达人', icon: '🌟', desc: '连续学习7天' },
  streak_30: { name: '单词小勇士', icon: '👑', desc: '连续学习30天' },
  words_100: { name: '百词斩', icon: '💯', desc: '累计学习100个词' },
  mistake_clear: { name: '零错误', icon: '✨', desc: '错词本全部清零' },
  perfect_week: { name: '完美一周', icon: '🏆', desc: '一周内每天都全对' },
  early_bird: { name: '早起鸟儿', icon: '🐦', desc: '早上8点前完成学习' }
};

const PETS = {
  dragon: { name: '小龙', emojis: ['🥚', '🐣', '🐉', '🐲'], stageNames: ['龙蛋', '龙宝宝', '少年龙', '神龙'] },
  cat: { name: '小喵', emojis: ['🐱', '😺', '😸', '🦁'], stageNames: ['小猫', '猫咪', '大猫', '狮子喵'] },
  star: { name: '小星', emojis: ['⭐', '🌟', '💫', '✨'], stageNames: ['小星星', '亮星星', '流星', '超新星'] }
};

function getLevel(exp) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (exp >= LEVELS[i].exp) return LEVELS[i];
  }
  return LEVELS[0];
}

function getLevelProgress(exp) {
  const cur = getLevel(exp);
  const nextIdx = LEVELS.findIndex(l => l.lv === cur.lv) + 1;
  if (nextIdx >= LEVELS.length) return 100;
  const next = LEVELS[nextIdx];
  return Math.round(((exp - cur.exp) / (next.exp - cur.exp)) * 100);
}

async function awardStars(count) {
  let result = null;
  await atomicUpdate(d => {
    const exp = count * 10;
    d.rewards.experience += exp;
    d.schedule.total_stars += count;

    const oldLevel = getLevel(d.rewards.experience - exp);
    const newLevel = getLevel(d.rewards.experience);
    const leveledUp = newLevel.lv > oldLevel.lv;

    // 每5天连续打卡给一个宝箱
    if (d.schedule.streak_days > 0 && d.schedule.streak_days % 5 === 0) {
      const today = todayStr();
      const alreadyGot = d.rewards.treasure_chests > 0; // simplified
      if (!alreadyGot) d.rewards.treasure_chests++;
    }

    result = {
      stars: count,
      totalStars: d.schedule.total_stars,
      exp: d.rewards.experience,
      level: newLevel,
      leveledUp,
      progress: getLevelProgress(d.rewards.experience)
    };
  });
  return result;
}

async function finalizeDailyRewards(starsEarned, mode = 'vocabulary', date = todayStr()) {
  if (!['vocabulary', 'listen-first'].includes(mode)) throw new Error('未知的学习模式');
  if (date !== todayStr()) throw new Error('学习日期已变化，请回到首页开始今天的练习');
  let result = null;
  await atomicUpdate(d => {
    if (date !== todayStr()) throw new Error('学习日期已变化，请回到首页开始今天的练习');
    if (mode === 'vocabulary' && typeof LearningResults !== 'undefined') {
      const rows = LearningResults.rows(d, date);
      if (rows.some(row => !row.complete)) throw new Error('练习记录不完整，不能把未记录当错题结算奖励');
      if (rows.length && rows.filter(row => row.correct).length !== Number(starsEarned)) throw new Error('答题结果与奖励数量不一致');
    }
    const today = todayStr();
    const yesterday = yesterdayStr();
    const day = getLearningDay(d, date, true);
    const legacyAwarded = d.schedule.rewards_awarded_date === date;
    // 老版本只有词汇模式奖励；迁移时保留已完成事实，但不猜测过去发了多少星。
    if (legacyAwarded && !day.modes.length) {
      day.stars = null;
      if (d.schedule.today_completed) day.modes.push('vocabulary');
    }
    const alreadyAwarded = legacyAwarded || day.modes.length > 0;
    const isNewMode = !day.modes.includes(mode);
    const newBadges = [];
    const count = Number.isFinite(Number(starsEarned)) ? Math.max(0, Number(starsEarned)) : 0;

    if (!alreadyAwarded) {
      if (d.schedule.last_learn_date === yesterday) {
        d.schedule.streak_days++;
      } else if (d.schedule.last_learn_date !== today) {
        d.schedule.streak_days = 1;
        d.schedule.streak_start = today;
      }

      const exp = count * 10;
      d.rewards.experience += exp;
      d.schedule.total_stars += count;
      d.rewards.treasure_chests++;
      day.stars = count;

      if (d.schedule.streak_days > 0 && d.schedule.streak_days % 5 === 0) {
        const alreadyGot = d.rewards.treasure_chests > 0;
        if (!alreadyGot) d.rewards.treasure_chests++;
      }

      if (d.schedule.streak_days === 3 && !d.rewards.badges.includes('streak_3')) {
        d.rewards.badges.push('streak_3');
        newBadges.push(BADGES.streak_3);
      }
      if (d.schedule.streak_days === 7 && !d.rewards.badges.includes('streak_7')) {
        d.rewards.badges.push('streak_7');
        newBadges.push(BADGES.streak_7);
      }
      if (d.schedule.streak_days === 30 && !d.rewards.badges.includes('streak_30')) {
        d.rewards.badges.push('streak_30');
        newBadges.push(BADGES.streak_30);
      }
    }

    if (mode === 'vocabulary' && isNewMode) {
      const learnedCount = d.words.filter(w => w.is_learned).length;
      if (learnedCount >= 100 && !d.rewards.badges.includes('words_100')) {
        d.rewards.badges.push('words_100');
        newBadges.push(BADGES.words_100);
      }

      const todayWords = d.schedule.today_words || [];
      const todayResults = (d.schedule.today_results || []).filter(r => r.date === today);
      const hasMistakes = todayWords.some(en => {
        const m = d.mistakes.find(m => m.english === en && m.last_wrong === today);
        const r = todayResults.find(r => r.english === en);
        return (m && !m.resolved) || !r || r.hadWrong || !r.correct;
      });
      if (!hasMistakes && todayWords.length >= 10 && !d.rewards.badges.includes('first_perfect')) {
        d.rewards.badges.push('first_perfect');
        newBadges.push(BADGES.first_perfect);
      }

      const allResolved = d.mistakes.length > 0 && d.mistakes.every(m => m.resolved);
      if (allResolved && !d.rewards.badges.includes('mistake_clear')) {
        d.rewards.badges.push('mistake_clear');
        newBadges.push(BADGES.mistake_clear);
      }
    }
    if (isNewMode) day.modes.push(mode);
    if (typeof recordAnimationTaskCompletion === 'function') recordAnimationTaskCompletion(d, date, mode);
    // 两种模式各记完成，学习日奖励只入账一次；听力不能替词汇流程做完或标掌握。
    if (mode === 'vocabulary') {
      d.schedule.today_completed = true;
      d.schedule.current_step = 4;
    }
    d.schedule.last_learn_date = today;
    d.schedule.rewards_awarded_date = today;

    result = {
      alreadyAwarded,
      stars: alreadyAwarded ? 0 : count,
      streakDays: d.schedule.streak_days,
      newBadges,
      totalStars: d.schedule.total_stars,
      level: getLevel(d.rewards.experience)
    };
  });
  return result;
}

async function updateStreak() {
  let result = null;
  await atomicUpdate(d => {
    const today = todayStr();
    const yesterday = yesterdayStr();

    if (d.schedule.last_learn_date === yesterday) {
      d.schedule.streak_days++;
    } else if (d.schedule.last_learn_date !== today) {
      d.schedule.streak_days = 1;
      d.schedule.streak_start = today;
    }

    const newBadges = [];
    if (d.schedule.streak_days === 3 && !d.rewards.badges.includes('streak_3')) {
      d.rewards.badges.push('streak_3');
      newBadges.push(BADGES.streak_3);
    }
    if (d.schedule.streak_days === 7 && !d.rewards.badges.includes('streak_7')) {
      d.rewards.badges.push('streak_7');
      newBadges.push(BADGES.streak_7);
    }
    if (d.schedule.streak_days === 30 && !d.rewards.badges.includes('streak_30')) {
      d.rewards.badges.push('streak_30');
      newBadges.push(BADGES.streak_30);
    }

    // 累计100词
    const learnedCount = d.words.filter(w => w.is_learned).length;
    if (learnedCount >= 100 && !d.rewards.badges.includes('words_100')) {
      d.rewards.badges.push('words_100');
      newBadges.push(BADGES.words_100);
    }

    d.schedule.last_learn_date = today;
    result = {
      streakDays: d.schedule.streak_days,
      newBadges,
      totalStars: d.schedule.total_stars,
      level: getLevel(d.rewards.experience)
    };
  });
  return result;
}

async function feedPet() {
  var today = todayStr();
  var fed = false;
  await atomicUpdate(d => {
    if (d.rewards.pet.last_fed === today) return; // 今天已经喂过
    fed = true;
    d.rewards.pet.happiness = Math.min(100, d.rewards.pet.happiness + 15);
    d.rewards.pet.last_fed = today;
    // 幸福度100时进化
    if (d.rewards.pet.happiness >= 100 && d.rewards.pet.stage < 4) {
      d.rewards.pet.stage++;
      d.rewards.pet.happiness = 50;
    }
  });
  return fed;
}

function getPetInfo(data) {
  const pet = data.rewards.pet;
  const petDef = PETS[pet.type] || PETS.dragon;
  return {
    type: pet.type,
    name: petDef.name,
    emoji: petDef.emojis[pet.stage - 1] || petDef.emojis[0],
    stageName: petDef.stageNames[pet.stage - 1] || petDef.stageNames[0],
    stage: pet.stage,
    happiness: pet.happiness,
    maxStage: petDef.emojis.length
  };
}

async function openTreasureChest() {
  let reward = null;
  await atomicUpdate(d => {
    if (d.rewards.treasure_chests <= 0) return;
    d.rewards.treasure_chests--;
    // 随机奖励
    const roll = Math.random();
	    if (roll < 0.4) reward = { type: 'stars', count: 5 + Math.floor(Math.random() * 10), icon: '⭐' };
	    else if (roll < 0.7) reward = { type: 'exp', count: 20 + Math.floor(Math.random() * 30), icon: '💎' };
	    else if (roll < 0.9) reward = { type: 'pet_item', name: '宠物装扮', icon: '👗' };
	    else reward = { type: 'badge', name: '限定徽章', icon: '🔮' };
	    if (reward.type === 'stars') d.schedule.total_stars += reward.count;
	    if (reward.type === 'exp') d.rewards.experience += reward.count;
	  });
  return reward;
}

async function checkBadges() {
  let result = [];
  await atomicUpdate(d => {
    // 首次全对
    const today = d.schedule.today_words;
    const todayStrValue = todayStr();
    const todayResults = (d.schedule.today_results || []).filter(r => r.date === todayStrValue);
    const hasMistakes = today.some(en => {
      const m = d.mistakes.find(m => m.english === en && m.last_wrong === todayStrValue);
      const r = todayResults.find(r => r.english === en);
      return (m && !m.resolved) || !r || r.hadWrong || !r.correct;
    });
    if (!hasMistakes && today.length >= 10 && !d.rewards.badges.includes('first_perfect')) {
      d.rewards.badges.push('first_perfect');
      result.push(BADGES.first_perfect);
    }
    // 错词清零
    const allResolved = d.mistakes.length > 0 && d.mistakes.every(m => m.resolved);
    if (allResolved && !d.rewards.badges.includes('mistake_clear')) {
      d.rewards.badges.push('mistake_clear');
      result.push(BADGES.mistake_clear);
    }
  });
  return result;
}
