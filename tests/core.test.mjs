import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(){
  const c={navigator:{},window:{},console,setTimeout,clearTimeout};
  vm.createContext(c);
  for(const name of ['storage','review-engine','animation-curriculum','speaking-progress','learning-results','rewards'])
    vm.runInContext(read('core/'+name+'.js'),c);
  vm.runInContext('globalThis.results=LearningResults;globalThis.speech=SpeakingProgress;',c);
  vm.runInContext(read('demo/lessons.js'),c);
  const date='2026-10-21';c.todayStr=()=>date;c.yesterdayStr=()=> '2026-10-20';
  let state=c.defaultData();
  c.loadData=async()=>structuredClone(state);
  c.saveData=async d=>{state=structuredClone(d)};
  return {c,date,get:()=>structuredClone(state),put:d=>{state=structuredClone(d)}};
}
test('missing evidence is unknown and a corrected error remains an error',async()=>{
  const {c,date}=fixture(),d=c.defaultData(),word={english:'star',chinese:'星星',context_id:'original:1:star'};
  Object.assign(d.schedule,{last_select_date:date,today_words:['star'],today_word_contexts:[word]});
  assert.equal(c.results.rows(d,date)[0].status,'unrecorded');
  for(const stage of ['choice','match','listen'])c.results.record(d,word,date,true,'star',stage);
  assert.equal(c.results.rows(d,date)[0].correct,true);
  c.results.record(d,word,date,false,'moon','choice');c.results.record(d,word,date,true,'star','choice');
  assert.equal(c.results.rows(d,date)[0].correct,false);
  assert.equal(c.results.rows(d,date)[0].hadWrong,true);
});
test('a saved score cannot leak recording URLs or raw responses',()=>{
  const {c,date}=fixture(),d=c.defaultData(),word={english:'star',example:'I can see a star.',context_id:'original:1:star'};
  Object.assign(d.schedule,{last_select_date:date,today_words:['star'],today_word_contexts:[word]});
  c.speech.set(d,word,date,{word_passed:true,target:'star',mode:'word',passed:true,
    result:{score:90,raw:'PRIVATE_RAW',recording:{replayUrl:'blob:PRIVATE'},request:{secret:'PRIVATE'}}});
  const saved=JSON.stringify(d.schedule.speaking_progress);
  assert.doesNotMatch(saved,/PRIVATE|replayUrl|secret/);
  assert.equal(c.speech.get(d,word,date).latest.result.score,90);
});
test('deferred speech never becomes a fabricated pass',()=>{
  const {c,date}=fixture(),d=c.defaultData(),word={english:'star',example:'I can see a star.',context_id:'original:1:star'};
  Object.assign(d.schedule,{last_select_date:date,today_words:['star'],today_word_contexts:[word]});
  c.speech.defer(d,word,date);
  const entry=c.speech.get(d,word,date);
  assert.ok(entry.deferred);assert.equal(entry.word_passed,false);assert.equal(entry.sentence_passed,false);
  assert.equal(d.speaking.attempts.length,0);assert.equal(d.schedule.total_stars,0);
});
test('sentence evidence is isolated by date, course and exact context',()=>{
  const {c,date}=fixture(),d=c.defaultData();
  const base={example:'Look at the blue star.',series_id:'original',episode_id:'original:lesson-1',episode_number:1};
  const a={...base,english:'blue',context_id:'original:1:blue'},b={...base,english:'star',context_id:'original:1:star'};
  Object.assign(d.schedule,{last_select_date:date,today_words:['blue','star'],today_word_contexts:[a,b]});
  c.speech.set(d,a,date,{word_passed:true,sentence_passed:true,target:base.example,mode:'sentence',passed:true,result:{score:92}});
  assert.equal(c.speech.sharedSentence(d,b,date).result.score,92);
  assert.equal(c.speech.sharedSentence(d,b,'2026-10-22'),null);
  assert.equal(c.speech.sharedSentence(d,{...b,episode_id:'original:lesson-2'},date),null);
});
test('incomplete answers block rewards; repeated settlement cannot duplicate them',async()=>{
  const {c,date,get}=fixture();
  await c.prepareAnimationWords(await c.loadData(),date);
  let d=get(),list=c.getTodayWordObjects(d);
  await assert.rejects(c.finalizeDailyRewards(0,'vocabulary',date),/不完整/);
  for(const word of list)for(const stage of ['choice','match','listen'])c.results.record(d,word,date,true,word.english,stage);
  await c.saveData(d);
  await c.finalizeDailyRewards(10,'vocabulary',date);
  const after=get();
  assert.equal(after.schedule.total_stars,10);
  assert.equal(after.schedule.animation_curriculum.completed_context_ids.length,10);
  await c.finalizeDailyRewards(10,'vocabulary',date);
  assert.deepEqual(get(),after);
});
test('same words retain distinct sentences in consecutive original lessons',async()=>{
  const f=fixture(),{c,date,get}=f;
  await c.prepareAnimationWords(await c.loadData(),date);
  let d=get();const first=d.schedule.today_word_contexts[0].example;
  c.recordAnimationTaskCompletion(d,date,'vocabulary');await c.saveData(d);
  await c.prepareAnimationWords(await c.loadData(),'2026-10-22');
  d=get();assert.equal(d.schedule.today_animation_task.episode_number,2);
  assert.notEqual(d.schedule.today_word_contexts[0].example,first);
  assert.equal(d.schedule.today_word_contexts[0].english,'sun');
});
test('failed atomic save preserves the stored task and unlocks for retry',async()=>{
  const {c,date,get}=fixture();await c.prepareAnimationWords(await c.loadData(),date);
  const before=get(),save=c.saveData;
  c.saveData=async()=>{throw new Error('synthetic write failure')};
  await assert.rejects(c.atomicUpdate(d=>{d.schedule.total_stars=999}),/synthetic/);
  assert.deepEqual(get(),before);
  c.saveData=save;await c.atomicUpdate(d=>{d.schedule.today_progress=3});
  assert.equal(get().schedule.today_progress,3);
});
test('preview database and default UI have no microphone/assessment route',()=>{
  assert.match(read('core/storage.js'),/northstar_english_public_preview_v1/);
  assert.doesNotMatch(read('demo/index.html'),/adapters\/|tencent-soe/);
  assert.doesNotMatch(read('demo/app.js'),/getUserMedia|\.assess\(/);
});
test('script adapter preserves missing word-level score as missing',()=>{
  const c={window:{addEventListener(){}},navigator:{},console};vm.createContext(c);
  vm.runInContext(read('adapters/tencent-soe.js'),c);
  const r=c.TencentSOE.parseResult({result:{SuggestedScore:90,Words:[{Word:'star'}]}});
  assert.equal(r.words[0].accuracyProvided,false);
});
