/** Fake Builder 的固定产物：一个能玩、能通过硬验证的单文件打砖块。 */
export const SAMPLE_GAME_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>打砖块</title>
<style>
body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}
canvas{background:#222}
</style>
</head>
<body>
<canvas id="c" width="480" height="360"></canvas>
<script>
const cv=document.getElementById('c'),x=cv.getContext('2d');
const W=480,H=360,PADDLE_W=80,PADDLE_H=12,BALL_R=6;
let px=W/2-PADDLE_W/2, py=H-30;
let bx=W/2, by=H-60, bdx=2.6, bdy=-2.6;
let score=0;
const ROWS=5,COLS=8,BW=48,BH=16,GAP=4,OFFX=(W-(COLS*(BW+GAP)-GAP))/2,OFFY=40;
const colors=['#f66','#fa0','#ff0','#0c6','#49f'];
let bricks=[];
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)bricks.push({x:OFFX+c*(BW+GAP),y:OFFY+r*(BH+GAP),w:BW,h:BH,alive:true,color:colors[r]});
let keys={};
addEventListener('keydown',e=>{keys[e.key]=true;});
addEventListener('keyup',e=>{keys[e.key]=false;});
function resetBall(){bx=W/2;by=H-60;bdx=2.6;bdy=-2.6;}
function loop(){
  if(keys['ArrowLeft']||keys['a'])px-=6;
  if(keys['ArrowRight']||keys['d'])px+=6;
  px=Math.max(0,Math.min(W-PADDLE_W,px));
  bx+=bdx;by+=bdy;
  if(bx<BALL_R||bx>W-BALL_R)bdx*=-1;
  if(by<BALL_R)bdy*=-1;
  if(by>H-BALL_R-6)resetBall();
  if(by>py-BALL_R&&by<py+PADDLE_H+BALL_R&&bx>px&&bx<px+PADDLE_W)bdy=-Math.abs(bdy);
  for(const b of bricks){if(!b.alive)continue;if(bx>b.x&&bx<b.x+b.w&&by>b.y&&by<b.y+b.h){b.alive=false;bdy*=-1;score+=10;}}
  draw();requestAnimationFrame(loop);
}
function draw(){
  x.fillStyle='#222';x.fillRect(0,0,W,H);
  x.fillStyle='#fff';x.fillRect(px,py,PADDLE_W,PADDLE_H);
  x.fillStyle='#0ff';x.beginPath();x.arc(bx,by,BALL_R,0,7);x.fill();
  for(const b of bricks){if(!b.alive)continue;x.fillStyle=b.color;x.fillRect(b.x,b.y,b.w,b.h);}
  x.fillStyle='#eee';x.font='16px sans-serif';x.fillText('得分 '+score,8,18);
}
requestAnimationFrame(loop);
</script>
</body>
</html>`;

/** 修改者演示用 v2：顶部醒目计分板。 */
export const SAMPLE_GAME_V2_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>打砖块·计分板版</title>
<style>
body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
#scorebar{color:#0ff;font-size:22px;font-weight:bold;margin-bottom:10px;font-family:sans-serif}
canvas{background:#222}
</style>
</head>
<body>
<div id="scorebar">得分：0</div>
<canvas id="c" width="480" height="360"></canvas>
<script>
const cv=document.getElementById('c'),x=cv.getContext('2d');
const W=480,H=360,PADDLE_W=80,PADDLE_H=12,BALL_R=6;
let px=W/2-PADDLE_W/2, py=H-30;
let bx=W/2, by=H-60, bdx=2.6, bdy=-2.6;
let score=0;
const ROWS=5,COLS=8,BW=48,BH=16,GAP=4,OFFX=(W-(COLS*(BW+GAP)-GAP))/2,OFFY=40;
const colors=['#f66','#fa0','#ff0','#0c6','#49f'];
let bricks=[];
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)bricks.push({x:OFFX+c*(BW+GAP),y:OFFY+r*(BH+GAP),w:BW,h:BH,alive:true,color:colors[r]});
let keys={};
addEventListener('keydown',e=>{keys[e.key]=true;});
addEventListener('keyup',e=>{keys[e.key]=false;});
function resetBall(){bx=W/2;by=H-60;bdx=2.6;bdy=-2.6;}
function loop(){
  if(keys['ArrowLeft']||keys['a'])px-=6;
  if(keys['ArrowRight']||keys['d'])px+=6;
  px=Math.max(0,Math.min(W-PADDLE_W,px));
  bx+=bdx;by+=bdy;
  if(bx<BALL_R||bx>W-BALL_R)bdx*=-1;
  if(by<BALL_R)bdy*=-1;
  if(by>H-BALL_R-6)resetBall();
  if(by>py-BALL_R&&by<py+PADDLE_H+BALL_R&&bx>px&&bx<px+PADDLE_W)bdy=-Math.abs(bdy);
  for(const b of bricks){if(!b.alive)continue;if(bx>b.x&&bx<b.x+b.w&&by>b.y&&by<b.y+b.h){b.alive=false;bdy*=-1;score+=10;document.getElementById('scorebar').textContent='得分：'+score;}}
  draw();requestAnimationFrame(loop);
}
function draw(){
  x.fillStyle='#222';x.fillRect(0,0,W,H);
  x.fillStyle='#fff';x.fillRect(px,py,PADDLE_W,PADDLE_H);
  x.fillStyle='#0ff';x.beginPath();x.arc(bx,by,BALL_R,0,7);x.fill();
  for(const b of bricks){if(!b.alive)continue;x.fillStyle=b.color;x.fillRect(b.x,b.y,b.w,b.h);}
}
requestAnimationFrame(loop);
</script>
</body>
</html>`;
