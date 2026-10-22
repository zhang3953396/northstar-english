// Original examples written for this public release; no textbook or cartoon extract.
const DEMO_LESSONS = [
  ['sun','太阳','☀️','The sun is warm.','I can see the sun.'],
  ['moon','月亮','🌙','The moon is bright.','Look at the moon.'],
  ['star','星星','⭐','I can see a star.','The star is small.'],
  ['red','红色','🔴','My cup is red.','Find a red ball.'],
  ['green','绿色','🟢','The leaf is green.','I have a green cup.'],
  ['blue','蓝色','🔵','My bag is blue.','Find the blue box.'],
  ['walk','走路','🚶','We walk to the park.','I walk with my dad.'],
  ['jump','跳跃','🐇','I can jump.','Jump over the line.'],
  ['read','阅读','📖','I read with my mum.','We read a book.'],
  ['sleep','睡觉','😴','The cat likes to sleep.','I sleep in my bed.']
];
const WORD_BANK = DEMO_LESSONS.map(([english,chinese,emoji,example])=>({english,word:english,chinese,emoji,example,difficulty:1}));
const episodes = [1,2].map(number=>({id:'original:lesson-'+number,number,title:'原创示例 · 第'+number+'课',
  words:DEMO_LESSONS.map(([english,chinese,emoji,a,b],index)=>({english,word:english,chinese,emoji,
    example:number===1?a:b,difficulty:1,daily_eligible:true,context_id:'original:'+number+':'+index,
    series_id:'original',episode_id:'original:lesson-'+number,episode_number:number,episode:'原创示例 · 第'+number+'课'}))}));
window.NORTHSTAR_ANIMATION_LIBRARY={version:'original-demo-v1',curriculum_version:'original-demo-contexts-v1',
  priority_series:'original',sources:[{id:'original',title:'Original public examples'}],
  series_episodes:{original:episodes},series_words:{original:WORD_BANK}};
