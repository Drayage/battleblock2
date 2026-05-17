const W = 10;
let H = 20;
const CELL = 30;
const BASE7 = ['I','J','L','O','S','T','Z'];
const SHAPES = {
  I: [[1,1,1,1]], O: [[1,1],[1,1]], T: [[0,1,0],[1,1,1]],
  L: [[0,0,1],[1,1,1]], J: [[1,0,0],[1,1,1]], S: [[0,1,1],[1,1,0]], Z: [[1,1,0],[0,1,1]],
  P: [[1,1,1],[1,0,1]]
};
const COLORS = { I:'#57d3ff',O:'#ffd557',T:'#bf7bff',L:'#ffaf57',J:'#7fa3ff',S:'#79f58b',Z:'#ff7070',P:'#ff6ad5',X:'#8b95bf' };

const state = {
  round: 1, gold: 0, mp: 0, mpMax: 100, enemyHp: 20, enemyType: 'normal',
  board: [], bag: [], next: null, hold: null, holdUsed: false, active: null,
  enemy: { board: [], hp: 20, bag: [], next: null, active: null, dropTimer: 0, dropSpeed: 600, lastDamage: 0 },
  dropTimer: 0, dropSpeed: 500, running: true, pausedForPanel: false, lastDamage: 0,
  hasHighPowerRelic: false, hasSpecialPiece: false,
  aiMode: 'balanced',
  keys: new Set(),
  keyRepeat: {},
};

const boardCv = document.getElementById('board');
const bctx = boardCv.getContext('2d');
const enemyCv = document.getElementById('enemyBoard');
const ectx = enemyCv.getContext('2d');
const nextCv = document.getElementById('next').getContext('2d');
const holdCv = document.getElementById('hold').getContext('2d');
const panel = document.getElementById('eventPanel');

function initBoard(height = 20) {
  H = height;
  state.board = Array.from({length:H},()=>Array(W).fill(null));
  state.enemy.board = Array.from({length:H},()=>Array(W).fill(null));
  boardCv.height = H * CELL;
  enemyCv.height = H * 24;
  enemyCv.width = W * 24;
}

function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function rebuildBag(){ state.bag=[...shuffle([...BASE7]),...shuffle([...BASE7]),...shuffle([...BASE7])]; }
function rebuildEnemyBag(){ state.enemy.bag=[...shuffle([...BASE7]),...shuffle([...BASE7]),...shuffle([...BASE7])]; }
function popPieceType(){ if(state.bag.length===0) rebuildBag(); if(state.hasSpecialPiece && Math.random() < 0.12) return 'P'; return state.bag.pop(); }
function popEnemyPieceType(){ if(state.enemy.bag.length===0) rebuildEnemyBag(); return state.enemy.bag.pop(); }
function newPiece(type){ return {type, shape: SHAPES[type].map(r=>[...r]), x:3, y:H-1}; }
function rotate(shape){ return shape[0].map((_,i)=>shape.map(r=>r[i]).reverse()); }

function collidesOn(board,piece,x=piece.x,y=piece.y,shape=piece.shape){
  for(let py=0;py<shape.length;py++) for(let px=0;px<shape[py].length;px++) if(shape[py][px]){
    const bx=x+px, by=y-py;
    if(bx<0||bx>=W||by<0) return true;
    if(by<H && board[by][bx]) return true;
  }
  return false;
}

function spawn(){
  state.holdUsed=false;
  const t=state.next ?? popPieceType();
  state.next=popPieceType();
  state.active=newPiece(t);
  if(collidesOn(state.board,state.active)) return gameOver('게임 오버: 스폰 공간이 없습니다.');
}
function spawnEnemy(){
  const t=state.enemy.next ?? popEnemyPieceType();
  state.enemy.next=popEnemyPieceType();
  state.enemy.active=newPiece(t);
  if(collidesOn(state.enemy.board,state.enemy.active)) return gameOver('패배: 적이 필드를 장악했습니다.');
}

function lock(){
  const p=state.active;
  const baseAtk = state.hasHighPowerRelic ? 0.3 : 0.1;
  p.shape.forEach((row,py)=>row.forEach((v,px)=>{ if(v){ const by=p.y-py; if(by>=0&&by<H) state.board[by][p.x+px]={ type:p.type, atk: p.type==='P' ? 0.3 : baseAtk, manaBonus: p.type==='P' ? 1 : 0 }; }}));
  clearLines(state.board,'player');
  if(state.running) spawn();
}

function lockEnemy(){
  const p=state.enemy.active;
  p.shape.forEach((row,py)=>row.forEach((v,px)=>{ if(v){ const by=p.y-py; if(by>=0&&by<H) state.enemy.board[by][p.x+px]={ type:p.type, atk:0.1, manaBonus:0 }; }}));
  clearLines(state.enemy.board,'enemy');
  if(state.running) spawnEnemy();
}

function clearLines(board, owner){
  const lines=[];
  for(let y=0;y<H;y++) if(board[y].every(Boolean)) lines.push(y);
  if(!lines.length){ if(owner==='player') state.lastDamage=0; else state.enemy.lastDamage=0; return; }
  let dmg=0; let mp=0;
  for(const y of lines){ for(let x=0;x<W;x++){ const c=board[y][x]; dmg += c?.atk ?? 0.1; mp += 1 + (c?.manaBonus ?? 0); } }
  lines.sort((a,b)=>b-a).forEach(y=>board.splice(y,1));
  while(board.length<H) board.push(Array(W).fill(null));
  dmg = Math.round(dmg*10)/10;

  if(owner==='player'){
    state.lastDamage=dmg;
    state.enemyHp -= dmg;
    state.mp = Math.min(state.mpMax, state.mp+mp);
    if(state.enemyHp<=0) onBattleWin();
  } else {
    state.enemy.lastDamage=dmg;
    state.enemyHp = Math.max(0,state.enemyHp);
    const garbage = Math.max(1, Math.floor(dmg));
    addGarbageToPlayer(garbage);
    if(isPlayerTopBlocked()) gameOver('패배: 적의 공격으로 스폰 공간이 막혔습니다.');
  }
}

function addGarbageToPlayer(rows){
  for(let r=0;r<rows;r++){
    state.board.shift();
    const hole = Math.floor(Math.random()*W);
    const row = Array.from({length:W},(_,x)=> x===hole? null : {type:'X',atk:0,manaBonus:0});
    state.board.push(row);
  }
}
function isPlayerTopBlocked(){
  return state.board[H-1].some(Boolean);
}

function onBattleWin(){
  state.gold += state.enemyType === 'elite' ? 70 : 35;
  state.round += 1;
  if(state.round>20) return gameOver('승리! 20라운드 클리어');
  const needsShop = state.round===5 || state.round===10 || state.round===15;
  if(needsShop) showShop(); else showEnemyChoice();
}
function enemyHpByRound(round, type){ const base = Math.round(20 * Math.pow(1.12, round-1)); return type==='elite' ? Math.round(base*1.6) : base; }

function showPanel(title, options){
  state.pausedForPanel = true;
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>${title}</h3><div class="row" id="panelRow"></div>`;
  const row = document.getElementById('panelRow');
  options.forEach(opt=>{ const b=document.createElement('button'); b.textContent=opt.label; b.onclick=()=>{ panel.classList.add('hidden'); state.pausedForPanel=false; opt.onClick(); }; row.appendChild(b); });
}
function showEnemyChoice(){
  const cards=[{type:'normal',label:'일반 몹',reward:'+35G'},{type:'normal',label:'일반 몹+',reward:'+40G'},{type:'elite',label:'엘리트 몹',reward:'+70G / 고난도'}];
  showPanel(`라운드 ${state.round}: 적 선택`, cards.map(c=>({label:`${c.label} (${c.reward})`,onClick:()=>startBattle(c.type)})));
}
function showShop(){
  showPanel(`상점 (Gold ${state.gold})`,[
    {label:'HP +5 (60G)',onClick:()=>{ if(state.gold>=60){ state.gold-=60; expandBoard(5);} startBattle('normal');}},
    {label:'고화력 유물 (50G)',onClick:()=>{ if(state.gold>=50){ state.gold-=50; state.hasHighPowerRelic=true;} startBattle('normal');}},
    {label:'특수 5칸 블록 추가 (40G)',onClick:()=>{ if(state.gold>=40){ state.gold-=40; state.hasSpecialPiece=true;} startBattle('normal');}},
    {label:'구매 안 함',onClick:()=>startBattle('normal')},
  ]);
}
function expandBoard(rows){
  for(let i=0;i<rows;i++){ state.board.push(Array(W).fill(null)); state.enemy.board.push(Array(W).fill(null)); }
  H = state.board.length; boardCv.height = H*CELL; enemyCv.height = H*24;
}
function startBattle(type){
  state.enemyType = type;
  state.enemyHp = enemyHpByRound(state.round, type);
  const mode = state.aiMode;
  const base = mode==='fast' ? 500 : mode==='tetris' ? 700 : 620;
  state.enemy.dropSpeed = type==='elite' ? Math.max(320, base-140) : base;
  message(`라운드 ${state.round} 시작 (${type}) - 1vs1 테트리스`);
}

function gameOver(msg){ state.running=false; message(msg); }
function message(m){ document.getElementById('message').textContent=m; }

function hardDrop(){ if(!state.active) return; while(!collidesOn(state.board,state.active,state.active.x,state.active.y-1)) state.active.y--; lock(); }
function hold(){ if(!state.active||state.holdUsed) return; const cur=state.active.type; if(!state.hold){ state.hold=cur; spawn(); } else { const t=state.hold; state.hold=cur; state.active=newPiece(t); } state.holdUsed=true; }
function castCompress(){ if(state.mp<30||!state.active) return; state.mp-=30; state.active.shape=[[1]]; if(collidesOn(state.board,state.active,state.active.x,state.active.y,state.active.shape)){ state.active.x=4; state.active.y=H-1; } }
function castPurify(){ if(state.mp<60) return; state.mp-=60; for(let y=0;y<Math.min(3,H);y++) state.board[y]=Array(W).fill(null); }

function move(dx){ if(state.active&&!collidesOn(state.board,state.active,state.active.x+dx,state.active.y)) state.active.x+=dx; }
function softDrop(){ if(state.active&&!collidesOn(state.board,state.active,state.active.x,state.active.y-1)) state.active.y--; }
function doRotate(){ if(!state.active) return; const r=rotate(state.active.shape); if(!collidesOn(state.board,state.active,state.active.x,state.active.y,r)) state.active.shape=r; }

function enemyChooseX(piece){
  let bestX=0, bestScore=1e9;
  for(let x=-2;x<W;x++){
    let y=H-1;
    while(!collidesOn(state.enemy.board,piece,x,y-1,piece.shape)) y--;
    if(collidesOn(state.enemy.board,piece,x,y,piece.shape)) continue;
    let score=0;
    piece.shape.forEach((row,py)=>row.forEach((v,px)=>{ if(v){ const by=y-py; score += by; }}));
    if (state.aiMode==='tetris') score -= clearPotentialAt(state.enemy.board, piece, x, y)*8;
    if (state.aiMode==='fast') score += Math.random()*3;
    if(score<bestScore){ bestScore=score; bestX=x; }
  }
  return bestX;
}

function clearPotentialAt(board, piece, x, y){
  const clone = board.map(r=>r.slice());
  piece.shape.forEach((row,py)=>row.forEach((v,px)=>{ if(v){ const by=y-py; if(by>=0&&by<H) clone[by][x+px]=1; }}));
  let c=0; for(let yy=0;yy<H;yy++) if(clone[yy].every(Boolean)) c++; return c;
}

function stepEnemy(dt){
  const e=state.enemy;
  if(!e.active) return;
  if(e.active.x < e.targetX && !collidesOn(e.board,e.active,e.active.x+1,e.active.y)) e.active.x++;
  else if(e.active.x > e.targetX && !collidesOn(e.board,e.active,e.active.x-1,e.active.y)) e.active.x--;
  e.dropTimer += dt;
  if(e.dropTimer >= e.dropSpeed){
    e.dropTimer=0;
    if(!collidesOn(e.board,e.active,e.active.x,e.active.y-1)) e.active.y--;
    else lockEnemy();
  }
}

function dasDelay(n){ return n<2?180:n<5?120:n<10?70:45; }
document.addEventListener('keydown',(e)=>{
  if(!state.running||state.pausedForPanel) return;
  if(state.keys.has(e.code)) return;
  state.keys.add(e.code);
  state.keyRepeat[e.code]={next:performance.now()+200,count:0};
  if(e.key==='ArrowLeft') move(-1);
  if(e.key==='ArrowRight') move(1);
  if(e.key==='ArrowDown') softDrop();
  if(e.key==='ArrowUp') doRotate();
  if(e.code==='Space') hardDrop();
  if(e.key==='c'||e.key==='C') hold();
  if(e.key==='1') castCompress();
  if(e.key==='2') castPurify();
});
document.addEventListener('keyup',(e)=>{ state.keys.delete(e.code); delete state.keyRepeat[e.code]; });
document.getElementById('skillCompress').onclick=castCompress;
document.getElementById('skillPurify').onclick=castPurify;
document.getElementById('btnLeft').onclick=()=>move(-1);
document.getElementById('btnRight').onclick=()=>move(1);
document.getElementById('btnRotate').onclick=doRotate;
document.getElementById('btnDrop').onclick=hardDrop;
document.getElementById('btnHold').onclick=hold;

function drawMini(ctx,type){ ctx.clearRect(0,0,120,120); if(!type) return; const s=SHAPES[type]; ctx.fillStyle=COLORS[type]||COLORS.X; s.forEach((r,y)=>r.forEach((v,x)=>{ if(v) ctx.fillRect(20+x*20,20+y*20,18,18); })); }
function drawBoard(ctx,board,active,cell){
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    ctx.strokeStyle='#253060'; ctx.strokeRect(x*cell,(H-1-y)*cell,cell,cell);
    const c=board[y][x]; if(c){ ctx.fillStyle=COLORS[c.type]||COLORS.X; ctx.fillRect(x*cell+1,(H-1-y)*cell+1,cell-2,cell-2); }
  }
  if(active){ ctx.fillStyle=COLORS[active.type]||COLORS.X; active.shape.forEach((r,py)=>r.forEach((v,px)=>{ if(v){ const bx=active.x+px, by=active.y-py; if(by>=0) ctx.fillRect(bx*cell+1,(H-1-by)*cell+1,cell-2,cell-2); }})); }
}

function render(){
  drawBoard(bctx,state.board,state.active,CELL);
  drawBoard(ectx,state.enemy.board,state.enemy.active,24);
  drawMini(nextCv,state.next); drawMini(holdCv,state.hold);
  document.getElementById('round').textContent=String(state.round);
  document.getElementById('enemyHp').textContent=String(Math.max(0,state.enemyHp));
  document.getElementById('enemyType').textContent=state.enemyType;
  document.getElementById('enemyLastDamage').textContent=state.enemy.lastDamage.toFixed(1);
  document.getElementById('mp').textContent=String(state.mp);
  document.getElementById('mpMax').textContent=String(state.mpMax);
  document.getElementById('gold').textContent=String(state.gold);
  document.getElementById('boardH').textContent=String(H);
  document.getElementById('lastDamage').textContent=String(state.lastDamage.toFixed(1));
}

let last=0;
function loop(ts){
  const now=performance.now();
  for (const code of state.keys){
    const r=state.keyRepeat[code]; if(!r||now<r.next) continue;
    r.next=now+dasDelay(r.count); r.count++;
    if(code==='ArrowLeft') move(-1);
    if(code==='ArrowRight') move(1);
    if(code==='ArrowDown') softDrop();
  }
  const dt=ts-last; last=ts;
  if(state.running && !state.pausedForPanel){
    state.dropTimer+=dt;
    if(state.dropTimer>=state.dropSpeed){ state.dropTimer=0; if(!collidesOn(state.board,state.active,state.active.x,state.active.y-1)) state.active.y--; else lock(); }
    stepEnemy(dt);
  }
  render(); requestAnimationFrame(loop);
}

initBoard(20);
rebuildBag(); rebuildEnemyBag();
spawn(); spawnEnemy();
if(state.enemy.active) state.enemy.targetX = enemyChooseX(state.enemy.active);
const _spawnEnemyOriginal = spawnEnemy;
spawnEnemy = function(){ _spawnEnemyOriginal(); if(state.enemy.active) state.enemy.targetX = enemyChooseX(state.enemy.active); };
document.getElementById('startBtn').onclick = () => {
  state.aiMode = document.getElementById('aiSel').value;
  document.getElementById('menu').style.display='none';
  document.getElementById('gameArea').style.display='flex';
  showEnemyChoice();
  message('게임 시작!');
};
requestAnimationFrame(loop);
