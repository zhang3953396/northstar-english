'use strict';
const app=document.querySelector('#app'), notice=document.querySelector('#notice');
let data, busy=false, screen=0, heard=false, utterance=null, speechTimer=null;
const phases=['intro','choice','match','listen'];
const labels={intro:'听与说',choice:'选择意思',match:'找英文',listen:'听音选择'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=text=>{notice.textContent=text};
function stopSpeech(){++screen;heard=false;clearTimeout(speechTimer);if('speechSynthesis'in window)window.speechSynthesis.cancel();utterance=null}
const words=()=>getTodayWordObjects(data);
const progress=()=>data.schedule.public_preview||{index:0,phase:'intro'};
function checkCurrent(d,index,phase){
  const p=d.schedule.public_preview;
  if(d.schedule.last_select_date!==todayStr()||p?.index!==index||p.phase!==phase)throw new Error('练习位置已变化，请刷新后继续。');
}
async function action(update){
  if(busy)return;
  busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{const feedback=await update();data=await loadData();await finishIfReady();render();if(feedback)message(feedback)}
  catch(error){data=await loadData();render();message('保存未完成：'+error.message)}
  finally{busy=false}
}
async function finishIfReady(){
  if(progress().index<words().length||data.schedule.today_completed)return;
  const rows=LearningResults.rows(data,todayStr(),WORD_BANK);
  if(rows.some(row=>!row.complete))throw new Error('还存在未记录完整的练习，请先完成。');
  await finalizeDailyRewards(rows.filter(row=>row.correct).length,'vocabulary',todayStr());
  data=await loadData();
}
function render(){
  stopSpeech();message('');
  const list=words(),p=progress(),word=list[p.index];
  if(data.schedule.today_completed||!word){
    const rows=LearningResults.rows(data,todayStr(),WORD_BANK);
    const correct=rows.filter(row=>row.correct).length;
    app.innerHTML='<section class="card"><div class="meta"><span>今天的练习已保存</span><span>第 '+data.schedule.today_animation_task.episode_number+' 课</span></div><h2>又向前走了一步 ✦</h2><p>每一次尝试都值得留下。答错再改对会保留最初的错误，明天再见。</p><div class="summary"><div class="stat"><strong>'+correct+'/'+list.length+'</strong>首次巩固答对的词</div><div class="stat"><strong>'+data.schedule.total_stars+'</strong>累计学习星星</div></div><ul class="results">'+rows.map(row=>'<li><span>'+esc(row.english)+' · '+esc(row.chinese)+'</span><span>'+(row.hadWrong?'需要再练':row.complete?'巩固完成':'未记录完整')+'</span></li>').join('')+'</ul><p class="subtle">这里没有评测你的发音；星星只对应已保存的巩固答案。刷新不会重复发奖。</p></section>';
    return;
  }
  const showWord=p.phase!=='listen',symbol=p.phase==='intro'?word.emoji:'✦';
  let body='<div class="word"><div class="symbol">'+esc(symbol)+'</div><h2>'+(showWord?esc(p.phase==='match'?word.chinese:word.english):'听听是哪个词')+'</h2>';
  body+=p.phase==='intro'?'<div class="sentence">'+esc(word.example)+'</div><p>'+esc(word.chinese)+'</p>':'<p>'+({choice:'选择这个词的意思',match:'找到对应的英文',listen:'播放声音，再选出听到的词'}[p.phase])+'</p>';
  body+='</div>';
  if(p.phase==='intro'||p.phase==='listen'){
    body+='<div class="row"><button data-speak="word">▶ 听单词</button><button data-speak="slow">◷ 慢一点</button>'+(p.phase==='intro'?'<button data-speak="sentence">▶ 听例句</button>':'')+'</div>';
  }
  if(p.phase==='intro')body+='<p class="subtle">可以跟着读一遍。这一版不录音、不评发音分。</p><div class="row"><button class="primary" data-continue="practice">开始巩固 →</button><button data-continue="later">稍后再跟读</button></div>';
  else{
    const options=[word,...list.filter(item=>item.english!==word.english).slice(0,3)].sort((a,b)=>a.english.localeCompare(b.english));
    body+='<div class="options">'+options.map(item=>'<button data-answer="'+esc(item.english)+'"'+(p.phase==='listen'?' disabled':'')+'>'+esc(p.phase==='choice'?item.chinese:item.english)+'</button>').join('')+'</div>';
    if(p.phase==='listen')body+='<p class="subtle">声音播放结束后可选择答案。没有声音可以先关闭页面，进度会保留。</p>';
  }
  app.innerHTML='<section class="card"><div class="meta"><span>第 '+data.schedule.today_animation_task.episode_number+' 课 · 原创示例</span><span>第 '+(p.index+1)+' / '+list.length+' 个词</span></div><progress max="'+list.length+'" value="'+p.index+'"></progress>'+body+'<div class="steps">'+phases.map(phase=>'<span'+(p.phase===phase?' class="active"':'')+'>'+labels[phase]+'</span>').join('')+'</div></section>';
}
function speak(kind){
  if(busy)return;
  if(!('speechSynthesis'in window)||!window.SpeechSynthesisUtterance){message('当前浏览器没有可用的朗读，请使用支持朗读的浏览器。');return}
  stopSpeech();
  const currentScreen=screen,word=words()[progress().index],phase=progress().phase;
  if(phase==='listen')document.querySelectorAll('[data-answer]').forEach(button=>button.disabled=true);
  const speech=new SpeechSynthesisUtterance(kind==='sentence'?word.example:word.english);
  utterance=speech;speech.lang='en-US';speech.rate=kind==='slow'?0.65:0.9;
  speech.onend=()=>{
    if(screen!==currentScreen)return;
    clearTimeout(speechTimer);utterance=null;
    if(phase==='listen'){heard=true;document.querySelectorAll('[data-answer]').forEach(button=>button.disabled=false)}
    message('听完了，可以继续。');
  };
  speech.onerror=()=>{if(screen!==currentScreen)return;clearTimeout(speechTimer);utterance=null;message('朗读未完成，请再试一次；本次不会记成听过。')};
  speechTimer=setTimeout(()=>{if(screen===currentScreen){stopSpeech();message('朗读没有完成，请重试。')}},30000);
  message('正在播放…');window.speechSynthesis.speak(speech);
}
app.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button||button.disabled||busy)return;
  if(button.dataset.speak){speak(button.dataset.speak);return}
  const p={...progress()},word=words()[p.index];
  if(button.dataset.continue){
    const later=button.dataset.continue==='later';
    action(async()=>atomicUpdate(d=>{
      checkCurrent(d,p.index,p.phase);
      if(later)SpeakingProgress.defer(d,word,todayStr(),{mode:'sentence',reason:'public-preview-user-deferred'});
      d.schedule.public_preview={index:p.index,phase:'choice',task_id:d.schedule.today_animation_task.id};
    }));return;
  }
  if(button.dataset.answer){
    if(p.phase==='listen'&&!heard){message('请先完整听完声音。');return}
    const correct=button.dataset.answer===word.english,value=button.dataset.answer;
    action(async()=>{
      await atomicUpdate(d=>{
        checkCurrent(d,p.index,p.phase);
        LearningResults.record(d,word,todayStr(),correct,value,p.phase);
        if(!correct){applyVocabularyAnswer(d,word.english,false,value);return}
        if(p.phase==='listen')applyVocabularyAnswer(d,word.english,true);
        d.schedule.public_preview={index:p.phase==='listen'?p.index+1:p.index,
          phase:p.phase==='listen'?'intro':phases[phases.indexOf(p.phase)+1],task_id:d.schedule.today_animation_task.id};
      });
      if(!correct)return '这个还需要再练一次，再选一遍。';
    });
  }
});
async function boot(){
  data=await loadData();
  await prepareAnimationWords(data,todayStr());
  data=await loadData();
  if(data.schedule.public_preview?.task_id!==data.schedule.today_animation_task.id){
    await atomicUpdate(d=>{d.schedule.public_preview={index:0,phase:'intro',task_id:d.schedule.today_animation_task.id}});
    data=await loadData();
  }
  await finishIfReady();render();
}
window.addEventListener('pagehide',stopSpeech);
if(!navigator.locks){
  app.innerHTML='<section class="card error"><h2>请使用更新的浏览器</h2><p>当前浏览器不支持本预览需要的安全写入锁。</p></section>';
}else{
  navigator.locks.request('northstar-public-preview-writer',{ifAvailable:true},async lock=>{
    if(!lock){app.innerHTML='<section class="card"><h2>另一个预览正在练习</h2><p>请关掉其他北极星公开预览页面，再刷新这里继续。</p></section>';return}
    try{await boot()}catch(error){app.innerHTML='<section class="card error"><h2>暂时无法读取练习</h2><p>'+esc(error.message)+'</p></section>';return}
    await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));
  }).catch(error=>message(error.message));
}
