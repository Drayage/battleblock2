const W = 10;
const H = 20;
const CELL = 30;
const SHAPES = {
  I: [[1,1,1,1]], O: [[1,1],[1,1]], T: [[0,1,0],[1,1,1]],
  L: [[0,0,1],[1,1,1]], J: [[1,0,0],[1,1,1]], S: [[0,1,1],[1,1,0]], Z: [[1,1,0],[0,1,1]]
};
const COLORS = { I:'#57d3ff',O:'#ffd557',T:'#bf7bff',L:'#ffaf57',J:'#7fa3ff',S:'#79f58b',Z:'#ff7070',X:'#8b95bf' };

const state = {
  round: 1, gold: 0, mp: 0, mpMax: 100, enemyHp: 20,
  board: Array.from({length:H},()=>Array(W).fill(null)),
  bag: [], next: null, hold: null, holdUsed: false, active: null,
  dropTimer: 0, dropSpeed: 500, running: true, lastDamage: 0,
};

const boardCv = document.getElementById('board');
const bctx = boardCv.getContext('2d');
const nextCv = document.getElementById('next').getContext('2d');
const holdCv = document.getElementById('hold').getContext('2d');

function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function rebuildBag(){ const base=['I','J','L','O','S','T','Z']; state.bag=[...shuffle([...base]),...shuffle([...base]),...shuffle([...base])]; }
function popPieceType(){ if(state.bag.length===0) rebuildBag(); return state.bag.pop(); }
function newPiece(type){ return {type, shape: SHAPES[type].map(r=>[...r]), x:3, y:H-1}; }
function rotate(shape){ return shape[0].map((_,i)=>shape.map(r=>r[i]).reverse()); }
function collides(piece,x=piece.x,y=piece.y,shape=piece.shape){
  for(let py=0;py<shape.length;py++) for(let px=0;px<shape[py].length;px++) if(shape[py][px]){
    const bx=x+px, by=y-py;
    if(bx<0||bx>=W||by<0) return true;
    if(by<H && state.board[by][bx]) return true;
  }
  return false;
}
function spawn(){
  state.holdUsed=false;
  const t=state.next ?? popPieceType();
  state.next=popPieceType();
  state.active=newPiece(t);
  if(collides(state.active)) return gameOver('게임 오버: 보드가 가득 찼습니다');
}
function lock(){
  const p=state.active;
  p.shape.forEach((row,py)=>row.forEach((v,px)=>{ if(v){ const by=p.y-py; if(by>=0&&by<H) state.board[by][p.x+px]={type:p.type,atk:0.1}; }}));
  clearLines(); spawn();
}
function clearLines(){
  let lines=[];
  for(let y=0;y<H;y++) if(state.board[y].every(Boolean)) lines.push(y);
  if(!lines.length){ state.lastDamage=0; return; }
  let dmg=0; let mp=0;
  for(const y of lines){ for(let x=0;x<W;x++){ const c=state.board[y][x]; dmg += c?.atk ?? 0.1; mp += 1; } }
  lines.forEach(y=>state.board.splice(y,1));
  while(state.board.length<H) state.board.push(Array(W).fill(null));
  dmg=Math.round(dmg*10)/10;
  state.lastDamage=dmg;
  state.enemyHp-=dmg;
  state.mp=Math.min(state.mpMax,state.mp+mp);
  if(state.enemyHp<=0) nextRound();
}
function nextRound(){
  state.gold += 20 + state.round*5;
  state.round += 1;
  if(state.round>20) return gameOver('승리! 20라운드를 클리어했습니다.');
  state.enemyHp = Math.round(20 * Math.pow(1.12, state.round-1));
  message(`라운드 ${state.round} 시작! (필드는 유지됩니다)`);
}
function gameOver(msg){ state.running=false; message(msg); }
function message(m){ document.getElementById('message').textContent=m; }

function hardDrop(){ while(!collides(state.active,state.active.x,state.active.y-1)) state.active.y--; lock(); }
function hold(){ if(state.holdUsed) return; const cur=state.active.type; if(!state.hold){ state.hold=cur; spawn(); } else { const t=state.hold; state.hold=cur; state.active=newPiece(t); } state.holdUsed=true; }
function castCompress(){ if(state.mp<30||!state.active) return; state.mp-=30; const p=state.active; p.shape=[[1]]; if(collides(p,p.x,p.y,p.shape)) { p.y=H-1; p.x=4; } }
function castPurify(){ if(state.mp<60) return; state.mp-=60; for(let y=0;y<3;y++) state.board[y]=Array(W).fill(null); }

document.addEventListener('keydown',(e)=>{
  if(!state.running||!state.active) return;
  if(e.key==='ArrowLeft'&&!collides(state.active,state.active.x-1,state.active.y)) state.active.x--;
  if(e.key==='ArrowRight'&&!collides(state.active,state.active.x+1,state.active.y)) state.active.x++;
  if(e.key==='ArrowDown'&&!collides(state.active,state.active.x,state.active.y-1)) state.active.y--;
  if(e.key==='ArrowUp'){ const r=rotate(state.active.shape); if(!collides(state.active,state.active.x,state.active.y,r)) state.active.shape=r; }
  if(e.code==='Space') hardDrop();
  if(e.key==='c'||e.key==='C') hold();
  if(e.key==='1') castCompress();
  if(e.key==='2') castPurify();
});

document.getElementById('skillCompress').onclick=castCompress;
document.getElementById('skillPurify').onclick=castPurify;

function drawMini(ctx,type){ ctx.clearRect(0,0,120,120); if(!type) return; const s=SHAPES[type]; ctx.fillStyle=COLORS[type]; s.forEach((r,y)=>r.forEach((v,x)=>{ if(v) ctx.fillRect(20+x*20,20+y*20,18,18); })); }
function render(){
  bctx.clearRect(0,0,boardCv.width,boardCv.height);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    bctx.strokeStyle='#253060'; bctx.strokeRect(x*CELL,(H-1-y)*CELL,CELL,CELL);
    const c=state.board[y][x]; if(c){ bctx.fillStyle=COLORS[c.type]||COLORS.X; bctx.fillRect(x*CELL+1,(H-1-y)*CELL+1,CELL-2,CELL-2); }
  }
  if(state.active){ bctx.fillStyle=COLORS[state.active.type]; state.active.shape.forEach((r,py)=>r.forEach((v,px)=>{ if(v){ const bx=state.active.x+px, by=state.active.y-py; if(by>=0) bctx.fillRect(bx*CELL+1,(H-1-by)*CELL+1,CELL-2,CELL-2); }})); }
  drawMini(nextCv,state.next); drawMini(holdCv,state.hold);
  ['round','enemyHp','mp','mpMax','gold','lastDamage'].forEach(id=>document.getElementById(id).textContent=String(state[id]));
}

let last=0;
function loop(ts){ if(!state.running) return render(); const dt=ts-last; last=ts; state.dropTimer+=dt;
  if(state.dropTimer>=state.dropSpeed){ state.dropTimer=0; if(!collides(state.active,state.active.x,state.active.y-1)) state.active.y--; else lock(); }
  render(); requestAnimationFrame(loop);
}
rebuildBag(); spawn(); requestAnimationFrame(loop); message('게임 시작!');
