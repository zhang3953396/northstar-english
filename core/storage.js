// storage.js — 识词小勇士 IndexedDB 存储层
// 零服务器依赖，100% 本地存储

const DB_NAME = 'northstar_english_public_preview_v1';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('app_data')) {
        db.createObjectStore('app_data', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(granted => {
      console.log('Persistent storage:', granted);
    });
  }
}

function defaultData() {
  return {
    words: [],           // 已学习的单词进度
    learning_days: [],   // 双模式的实际学习日与听力记录；听过不等于已掌握
    schedule: {
      last_learn_date: '',
      last_select_date: '',
      rewards_awarded_date: '',
      streak_start: '',
      streak_days: 0,
      total_stars: 0,
      today_words: [],      // 今天10个词的英文key列表
      today_new_count: 6,
      today_review_count: 4,
      today_completed: false,
      current_step: 0,       // 0=首页, 1=认识, 2=拼写, 3=小测, 4=总结
      today_progress: 0,     // 中断续做的进度索引（已完成的下一个单词索引）
      today_resume_word: '', // 中断续做时当前词的稳定标识，避免只靠序号恢复
      starter_daily_version: '',
      retired_daily_words: [], // 已由新版首日词替换的旧词，不再被日常排词选回
      previous_daily_words: [], // 上次词表；新词/随机补位避开，到期复习和错词不受此限制
      today_word_contexts: [], // 动画原表的当天词义/例句，词汇掌握和错词仍使用全局英文 key
      animation_library_version: '',
      animation_days: [],
      animation_curriculum: null, // 已完成练习的原文语境 ID；不是词汇掌握或集数打卡猜测
      today_animation_task: null,
      speaking_progress: null, // 当天、当前原句的跟读通过状态与可见词分；不存录音/原始响应
      vocabulary_group: null, // 当前五词连线/听力组；只从本组实际保存的回答恢复
      today_results: []      // 今日每个词的实际表现：只要错过一次，总结就不算全对
    },
    mistakes: [],         // 错词本
    speaking: {
      attempts: [],       // 腾讯跟读事件，供家长日报与两周验证导出
      review_words: [],   // 需要重新跟读的词
      review_sentences: []
    },
    dialogue: {
      completed_clips: [],
      last_clip_id: ''
    },
    rewards: {
      level: 1,
      experience: 0,
      badges: [],
      pet: { type: 'dragon', stage: 1, happiness: 50, last_fed: '' },
      treasure_chests: 0
    },
    settings: {
      difficulty: 'medium',
      sound_enabled: true,
      daily_goal: 10,
      new_words_per_day: 6,
      // 听力中断位置与 learning_days 播放记录分开；不把听过误记为已掌握。
      listen_first_progress: 0,
      listen_first_phase: 'input',
      listen_first_list_key: ''
    }
  };
}

function getLearningDay(data, date = todayStr(), create = false) {
  let day = (data.learning_days || []).find(item => item.date === date);
  if (!day && create) {
    day = { date, modes: [], stars: 0, listening: [] };
    if (!data.learning_days) data.learning_days = [];
    data.learning_days.push(day);
  }
  return day || null;
}

async function loadData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('app_data', 'readonly');
    const store = tx.objectStore('app_data');
    const req = store.get('data');
    req.onsuccess = () => {
      let d = req.result ? req.result.data : null;
      if (!d) d = defaultData();
      // 向后兼容：补全缺失字段
      const def = defaultData();
      for (const k of Object.keys(def)) {
        if (!(k in d)) d[k] = def[k];
        else if (typeof def[k] === 'object' && !Array.isArray(def[k])) {
          for (const sk of Object.keys(def[k])) {
            if (!(sk in d[k])) d[k][sk] = def[k][sk];
          }
        }
      }
      if (!d.schedule.last_select_date && d.schedule.today_words.length) {
        d.schedule.last_select_date = d.schedule.last_learn_date || '';
      }
      resolve(d);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveData(d) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('app_data', 'readwrite');
    const store = tx.objectStore('app_data');
    store.put({ key: 'data', data: d });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let _saveLock = false;
async function atomicUpdate(fn) {
  while (_saveLock) await new Promise(r => setTimeout(r, 10));
  _saveLock = true;
  try {
    const data = await loadData();
    await fn(data);
    await saveData(data);
  } finally {
    _saveLock = false;
  }
}

async function exportAllData() {
  const data = await loadData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '识词小勇士_备份_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.words || !data.schedule) throw new Error('无效的备份文件');
  await saveData(data);
  return data;
}

// Persistence permission is opt-in in the public preview.

