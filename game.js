/* Love Platformer (Canvas)
   - Original characters (Luna & Rio)
   - Mosaic/pixel vibe background
   - Tilemap collisions + enemies + collectibles
   - GitHub Pages friendly (no build tools)
*/

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const uiHearts = document.getElementById("hearts");
  const uiStars  = document.getElementById("stars");
  const uiTime   = document.getElementById("time");
  const btnRestart = document.getElementById("btnRestart");
  const btnMute = document.getElementById("btnMute");

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- Input ----------
  const keys = new Set();
  const pressed = new Set(); // edge-trigger
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (!keys.has(k)) pressed.add(k);
    keys.add(k);
    // prevent page scroll on arrows/space
    if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key)) e.preventDefault();
  }, { passive:false });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
  });

  function down(...list){ return list.some(k => keys.has(k)); }
  function tap(...list){
    const hit = list.some(k => pressed.has(k));
    return hit;
  }

  // ---------- Tiny synth music (optional) ----------
  let audioCtx = null;
  let musicOn = true;
  let musicTimer = 0;

  function ensureAudio(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function beep(freq, dur, type="square", vol=0.03){
    if (!musicOn) return;
    ensureAudio();
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.stop(t0 + dur + 0.01);
  }

  function playCollect(){ beep(880, 0.08, "square", 0.04); beep(1320, 0.06, "square", 0.03); }
  function playHurt(){ beep(220, 0.12, "sawtooth", 0.04); }
  function playWin(){ beep(660, 0.09, "square", 0.04); beep(880, 0.09, "square", 0.04); beep(1320, 0.12, "square", 0.04); }

  btnMute.addEventListener("click", () => {
    musicOn = !musicOn;
    btnMute.textContent = `Music: ${musicOn ? "On" : "Off"}`;
  });

  // ---------- Game constants ----------
  const W = canvas.width, H = canvas.height;
  const TILE = 30;
  const GRAV = 2200;
  const FRICTION = 0.86;

  // Camera
  const cam = { x: 0, y: 0 };

  // ---------- Level (tilemap) ----------
  // 0 empty, 1 solid, 3 deadly spikes, 4 portal base
  const levelCols = 64;
  const levelRows = 18;

  const mapStr = [
    "................................................................",
    "................................................................",
    "................................................................",
    "...............h...............s...............................P",
    "..............111.............111..............................4",
    "...............................................h...............1",
    ".....................111..........................111..........1",
    ".............e..................................................",
    "..........111111......................s.........................",
    ".....................................111...................h....",
    "..................h.......................111.............111....",
    ".................111............................................",
    "..................................e.............................",
    "......s..............111111...............................e.....",
    ".....111..................................................1111..",
    "..................h.............s...............................",
    "..111............111...........111....................h.........",
    "1111111111111111111111111111111111111111111111111111111111111111",
  ];

  const tiles = new Array(levelRows).fill(0).map(()=> new Array(levelCols).fill(0));
  const hearts = [];
  const enemies = [];
  let portal = { x: 0, y: 0, w: TILE, h: TILE*2 };

  for (let r=0; r<levelRows; r++){
    for (let c=0; c<levelCols; c++){
      const ch = mapStr[r][c];
      const x = c*TILE, y = r*TILE;
      if (ch === "1") tiles[r][c] = 1;
      if (ch === "s") tiles[r][c] = 3;
      if (ch === "4") { tiles[r][c] = 4; portal.x = x; portal.y = y - TILE; portal.w = TILE; portal.h = TILE*2; }
      if (ch === "h") hearts.push({ x: x+TILE*0.2, y: y+TILE*0.2, w: TILE*0.6, h: TILE*0.6, taken:false, bob: Math.random()*10 });
      if (ch === "e") enemies.push({ x: x+TILE*0.1, y: y+TILE*0.15, w: TILE*0.8, h: TILE*0.7, vx: (Math.random() > 0.5 ? 1 : -1)*120, alive:true });
    }
  }

  const worldW = levelCols * TILE;
  const worldH = levelRows * TILE;

  // ---------- Player ----------
  const players = [
    { name: "Luna", colorA: "#ff5ac8", colorB: "#ffd1ef", jumpVel: 780, dashSpeed: 520, dashTime: 0.14 },
    { name: "Rio",  colorA: "#5affd2", colorB: "#d2fff1", jumpVel: 740, dashSpeed: 640, dashTime: 0.12 }
  ];

  const state = {
    active: 0,
    x: TILE*2,
    y: TILE*9,
    w: 22,
    h: 28,
    vx: 0,
    vy: 0,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    dash: 0,
    dashDir: 1,
    invuln: 0,
    hearts: 0,
    stars: 0,
    win: false,
    t0: performance.now(),
    timeSec: 0,
  };

  function reset(){
    state.active = 0;
    state.x = TILE*2;
    state.y = TILE*9;
    state.vx = 0; state.vy = 0;
    state.onGround = false;
    state.coyote = 0;
    state.jumpBuffer = 0;
    state.dash = 0;
    state.invuln = 0;
    state.hearts = 0;
    state.stars = 0;
    state.win = false;
    state.t0 = performance.now();
    state.timeSec = 0;
    hearts.forEach(h => h.taken = false);
    enemies.forEach(e => { e.alive = true; e.vx = (Math.random() > 0.5 ? 1 : -1)*120; });
  }

  btnRestart.addEventListener("click", reset);

  // ---------- Collisions ----------
  function rects(a,b){
    return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  }

  function tileAt(px, py){
    const c = Math.floor(px / TILE);
    const r = Math.floor(py / TILE);
    if (c < 0 || c >= levelCols || r < 0 || r >= levelRows) return 0;
    return tiles[r][c];
  }

  function resolveAxis(axis){
    const pw = state.w, ph = state.h;

    const left = Math.floor(state.x / TILE);
    const right = Math.floor((state.x+pw) / TILE);
    const top = Math.floor(state.y / TILE);
    const bottom = Math.floor((state.y+ph) / TILE);

    for (let r = top-1; r <= bottom+1; r++){
      for (let c = left-1; c <= right+1; c++){
        if (r < 0 || c < 0 || r >= levelRows || c >= levelCols) continue;
        const t = tiles[r][c];
        if (t === 0) continue;

        const tx = c*TILE, ty = r*TILE;
        const solid = (t === 1 || t === 4);
        if (!solid) continue;

        const a = { x: state.x, y: state.y, w: pw, h: ph };
        const b = { x: tx, y: ty, w: TILE, h: TILE };
        if (!rects(a,b)) continue;

        if (axis === "x"){
          if (state.vx > 0) state.x = tx - pw - 0.01;
          else if (state.vx < 0) state.x = tx + TILE + 0.01;
          state.vx = 0;
        } else {
          if (state.vy > 0){
            state.y = ty - ph - 0.01;
            state.vy = 0;
            state.onGround = true;
            state.coyote = 0.12;
          } else if (state.vy < 0){
            state.y = ty + TILE + 0.01;
            state.vy = 0;
          }
        }
      }
    }
  }

  function checkHazards(){
    const footY = state.y + state.h;
    const leftX = state.x + 3;
    const rightX = state.x + state.w - 3;

    const t1 = tileAt(leftX, footY);
    const t2 = tileAt(rightX, footY);

    if ((t1 === 3 || t2 === 3) && state.invuln <= 0) hurt();
  }

  function hurt(){
    playHurt();
    state.invuln = 0.9;
    state.vy = -520;
    state.vx = -state.dashDir * 220;
    state.stars = Math.max(0, state.stars - 1);
    if (state.stars === 0 && state.hearts > 0) state.hearts = Math.max(0, state.hearts - 1);
    if (state.hearts === 0 && state.stars === 0){
      state.x = TILE*2;
      state.y = TILE*9;
      state.vx = 0;
      state.vy = 0;
    }
  }

  // ---------- Update loop ----------
  let last = performance.now();

  function update(dt){
    if (!state.win){
      state.timeSec = (performance.now() - state.t0) / 1000;
    }

    const A = players[state.active];

    // switch character
    if (tap("c")){
      state.active = (state.active + 1) % players.length;
      state.stars++;
      playCollect();
    }

    const move = (down("a","arrowleft") ? -1 : 0) + (down("d","arrowright") ? 1 : 0);
    if (move !== 0) state.dashDir = move;

    // Jump buffering & coyote time
    if (tap("w","arrowup"," ")) state.jumpBuffer = 0.14;
    else state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);

    state.coyote = Math.max(0, state.coyote - dt);

    // Dash
    if (tap("shift") && state.dash <= 0 && !state.win){
      state.dash = A.dashTime;
      state.vy = Math.min(state.vy, 60);
      beep(520, 0.05, "square", 0.03);
    }

    state.onGround = false;

    if (!state.win){
      if (state.dash > 0){
        state.dash -= dt;
        state.vx = A.dashSpeed * state.dashDir;
      } else {
        const target = move * 300;
        state.vx = lerp(state.vx, target, 0.14);
        state.vx *= (state.onGround ? FRICTION : 0.98);
      }

      // gravity
      state.vy += GRAV * dt;
      state.vy = Math.min(state.vy, 1400);

      // jump if buffered and grounded/coyote
      if (state.jumpBuffer > 0 && (state.coyote > 0 ||
        tileAt(state.x+state.w/2, state.y+state.h+2) === 1 ||
        tileAt(state.x+state.w/2, state.y+state.h+2) === 4))
      {
        state.jumpBuffer = 0;
        state.vy = -A.jumpVel;
        state.dash = 0;
        beep(880, 0.05, "square", 0.03);
      }

      // Integrate X
      state.x += state.vx * dt;
      state.x = clamp(state.x, 0, worldW - state.w);
      resolveAxis("x");

      // Integrate Y
      state.y += state.vy * dt;
      state.y = clamp(state.y, 0, worldH - state.h);
      resolveAxis("y");
    }

    if (state.invuln > 0) state.invuln -= dt;

    // Collect hearts
    for (const h of hearts){
      if (h.taken) continue;
      const a = { x: state.x, y: state.y, w: state.w, h: state.h };
      const b = { x: h.x, y: h.y, w: h.w, h: h.h };
      if (rects(a,b)){
        h.taken = true;
        state.hearts++;
        playCollect();
      }
    }

    // Enemies
    for (const e of enemies){
      if (!e.alive) continue;

      e.x += e.vx * dt;
      const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
      const footY = e.y + e.h + 2;
      const tAhead = tileAt(aheadX, e.y + e.h * 0.6);
      const tFoot  = tileAt(aheadX, footY);

      if (tAhead === 1 || tAhead === 4 || (tFoot !== 1 && tFoot !== 4)){
        e.vx *= -1;
      }

      if (!state.win && state.invuln <= 0){
        const a = { x: state.x, y: state.y, w: state.w, h: state.h };
        const b = { x: e.x, y: e.y, w: e.w, h: e.h };
        if (rects(a,b)){
          const playerBottom = state.y + state.h;
          if (state.vy > 0 && playerBottom - e.y < 16){
            e.alive = false;
            state.vy = -520;
            state.stars += 2;
            playCollect();
          } else {
            hurt();
          }
        }
      }
    }

    checkHazards();

    // Win: touch portal AND collect at least 5 hearts
    if (!state.win){
      const a = { x: state.x, y: state.y, w: state.w, h: state.h };
      const b = { x: portal.x, y: portal.y, w: portal.w, h: portal.h };
      if (rects(a,b) && state.hearts >= 5){
        state.win = true;
        playWin();
      }
    }

    // Camera follow
    const cx = state.x + state.w/2;
    const cy = state.y + state.h/2;
    cam.x = clamp(cx - W/2, 0, worldW - W);
    cam.y = clamp(cy - H/2, 0, worldH - H);

    // UI
    uiHearts.textContent = state.hearts;
    uiStars.textContent = state.stars;

    const t = Math.floor(state.timeSec);
    const mm = Math.floor(t/60);
    const ss = String(t%60).padStart(2,"0");
    uiTime.textContent = `${mm}:${ss}`;
  }

  // ---------- Rendering ----------
  function mosaicBG(){
    const size = 24;
    const offsetX = -cam.x * 0.25;
    const offsetY = -cam.y * 0.18;

    for (let y = -size; y < H + size; y += size){
      for (let x = -size; x < W + size; x += size){
        const nx = x + offsetX;
        const ny = y + offsetY;
        const v = (Math.sin((nx+ny)*0.01) + Math.sin(nx*0.013) + Math.cos(ny*0.016))*0.5;
        const a = 0.12 + 0.08*Math.abs(v);
        ctx.fillStyle = `rgba(${Math.floor(150+90*Math.sin(nx*0.02))},${Math.floor(140+100*Math.sin(ny*0.018+1))},${Math.floor(170+80*Math.cos((nx+ny)*0.017))},${a})`;
        ctx.fillRect(x, y, size-1, size-1);
      }
    }
  }

  function drawTile(x,y,t){
    const gx = x - cam.x, gy = y - cam.y;
    if (t === 1){
      const hue = (x*0.03 + y*0.02) % 360;
      ctx.fillStyle = `hsl(${hue}, 85%, 55%)`;
      ctx.fillRect(gx, gy, TILE, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(gx+2, gy+2, TILE-4, TILE-4);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(gx+4, gy+TILE-7, TILE-8, 4);
    } else if (t === 3){
      ctx.fillStyle = "rgba(255,70,110,0.95)";
      for (let i=0; i<5; i++){
        const sx = gx + i*(TILE/5);
        ctx.beginPath();
        ctx.moveTo(sx, gy+TILE);
        ctx.lineTo(sx + (TILE/10), gy+6);
        ctx.lineTo(sx + (TILE/5), gy+TILE);
        ctx.closePath();
        ctx.fill();
      }
    } else if (t === 4){
      ctx.fillStyle = "rgba(120,160,255,0.85)";
      ctx.fillRect(gx, gy, TILE, TILE);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(gx+3, gy+3, TILE-6, TILE-6);
    }
  }

  function drawHeart(h){
    const gx = h.x - cam.x, gy = h.y - cam.y;
    const bob = Math.sin((performance.now()*0.004) + h.bob) * 4;
    ctx.save();
    ctx.translate(gx + h.w/2, gy + h.h/2 + bob);

    const p = 3;
    const shape = [
      "01100110",
      "11111111",
      "11111111",
      "11111111",
      "01111110",
      "00111100",
      "00011000",
      "00000000",
    ];
    for (let r=0; r<shape.length; r++){
      for (let c=0; c<shape[r].length; c++){
        if (shape[r][c] === "1"){
          ctx.fillStyle = "rgba(255,90,200,0.95)";
          ctx.fillRect((c-4)*p, (r-4)*p, p, p);
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect((c-4)*p+1, (r-4)*p+1, p-2, p-2);
        }
      }
    }
    ctx.restore();
  }

  function drawPortal(){
    const gx = portal.x - cam.x, gy = portal.y - cam.y;
    ctx.save();
    const pulse = 0.45 + 0.25*Math.sin(performance.now()*0.004);
    ctx.fillStyle = `rgba(140,80,255,${0.25 + pulse*0.15})`;
    ctx.fillRect(gx-8, gy-10, portal.w+16, portal.h+20);

    ctx.fillStyle = "rgba(30,10,60,0.55)";
    ctx.fillRect(gx, gy, portal.w, portal.h);

    const grad = ctx.createLinearGradient(gx, gy, gx, gy+portal.h);
    grad.addColorStop(0, "rgba(255,90,200,0.7)");
    grad.addColorStop(0.5, "rgba(90,255,210,0.65)");
    grad.addColorStop(1, "rgba(120,160,255,0.65)");
    ctx.fillStyle = grad;
    ctx.fillRect(gx+4, gy+4, portal.w-8, portal.h-8);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("Need 5 ❤", gx-6, gy-14);
    ctx.restore();
  }

  function drawEnemy(e){
    const gx = e.x - cam.x, gy = e.y - cam.y;
    ctx.save();
    ctx.translate(gx + e.w/2, gy + e.h/2);
    const wob = 1 + 0.06*Math.sin(performance.now()*0.01 + gx*0.01);
    ctx.scale(wob, 1/wob);
    ctx.fillStyle = "rgba(255,210,60,0.95)";
    ctx.beginPath();
    ctx.roundRect(-e.w/2, -e.h/2, e.w, e.h, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(20,20,30,0.85)";
    ctx.fillRect(-6, -2, 3, 4);
    ctx.fillRect( 3, -2, 3, 4);
    ctx.restore();
  }

  function drawPlayer(){
    const A = players[state.active];
    const gx = state.x - cam.x;
    const gy = state.y - cam.y;

    const blink = (Math.sin(performance.now()*0.01) > 0.98);
    const inv = state.invuln > 0 ? (Math.sin(performance.now()*0.03) > 0 ? 0.35 : 1.0) : 1.0;

    ctx.save();
    ctx.globalAlpha = inv;

    const grad = ctx.createLinearGradient(gx, gy, gx, gy+state.h);
    grad.addColorStop(0, A.colorB);
    grad.addColorStop(1, A.colorA);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(gx, gy, state.w, state.h, 8);
    ctx.fill();

    ctx.fillStyle = "rgba(20,20,30,0.75)";
    ctx.fillRect(gx + (state.dashDir>0? 13:7), gy+10, 3, blink?1:3);
    ctx.fillRect(gx + (state.dashDir>0? 17:11), gy+10, 3, blink?1:3);

    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(gx+3, gy+4, state.w-6, 3);

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.roundRect(gx-6, gy-22, 64, 18, 9);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(A.name, gx+2, gy-9);

    ctx.restore();
  }

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
      r = Math.min(r, w/2, h/2);
      this.beginPath();
      this.moveTo(x+r, y);
      this.arcTo(x+w, y, x+w, y+h, r);
      this.arcTo(x+w, y+h, x, y+h, r);
      this.arcTo(x, y+h, x, y, r);
      this.arcTo(x, y, x+w, y, r);
      this.closePath();
      return this;
    };
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0,0,W,H);
    mosaicBG();

    const hg = ctx.createRadialGradient(W*0.5, H*0.1, 40, W*0.5, H*0.1, 520);
    hg.addColorStop(0, "rgba(255,255,255,0.10)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0,0,W,H);

    const c0 = Math.floor(cam.x / TILE);
    const c1 = Math.ceil((cam.x + W) / TILE);
    const r0 = Math.floor(cam.y / TILE);
    const r1 = Math.ceil((cam.y + H) / TILE);

    for (let r=r0-1; r<=r1+1; r++){
      for (let c=c0-1; c<=c1+1; c++){
        if (r<0||c<0||r>=levelRows||c>=levelCols) continue;
        const t = tiles[r][c];
        if (t) drawTile(c*TILE, r*TILE, t);
      }
    }

    for (const h of hearts){
      if (!h.taken) drawHeart(h);
    }

    drawPortal();

    for (const e of enemies){
      if (e.alive) drawEnemy(e);
    }

    drawPlayer();

    if (state.win){
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      ctx.fillRect(0,0,W,H);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("YOU MADE IT TOGETHER ✨", 220, 210);

      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Hearts: ${state.hearts}   Stars: ${state.stars}`, 340, 250);
      ctx.fillText("Press Restart to play again. (Try swapping Luna/Rio with C)", 230, 285);
      ctx.restore();
    }
  }

  // ---------- Loop ----------
  function loop(now){
    const dt = Math.min(0.033, (now - last)/1000);
    last = now;

    update(dt);
    pressed.clear(); // ✅ FIX: clear AFTER update so tap() works
    draw();

    musicTimer += dt;
    if (musicOn && musicTimer > 0.65 && !state.win){
      musicTimer = 0;
      const base = 262; // C4
      const seq = [0, 7, 12, 16];
      const n = seq[Math.floor((performance.now()/650) % seq.length)];
      beep(base * Math.pow(2, n/12), 0.06, "triangle", 0.015);
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener("pointerdown", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }, { once:false });

  reset();
  requestAnimationFrame(loop);
})();
