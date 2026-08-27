'use strict';
// Couche "jeu" : toasts XP, confettis canvas, sons WebAudio, modales de célébration.
// Aucune dépendance : tout est synthétisé ici.

const fx = (() => {
  // ------------------------------------------------ sons (synthé WebAudio)
  let audioCtx = null;
  function soundOn() { return localStorage.getItem('chasse_sounds') !== '0'; }
  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, start, dur, { type = 'sine', gain = 0.12 } = {}) {
    const ac = ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    const t0 = ac.currentTime + start;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  const sounds = {
    coin() { tone(880, 0, .09, { type: 'square', gain: .06 }); tone(1318, .07, .14, { type: 'square', gain: .06 }); },
    quest() { [660, 880, 1100].forEach((f, i) => tone(f, i * .09, .12, { type: 'triangle' })); },
    level() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * .11, .3, { type: 'triangle', gain: .14 })); },
    badge() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * .08, .2, { type: 'sine', gain: .12 })); },
    cash() { [1568, 2093].forEach((f, i) => tone(f, i * .06, .1, { type: 'square', gain: .07 })); [523, 659, 784].forEach((f, i) => tone(f, .15 + i * .07, .25, { type: 'triangle', gain: .13 })); },
    boss() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * .13, .4, { type: 'sawtooth', gain: .07 })); },
    err() { tone(196, 0, .2, { type: 'sawtooth', gain: .06 }); },
    pop() { tone(440, 0, .05, { type: 'sine', gain: .05 }); },
  };
  function play(name) { if (soundOn()) { try { sounds[name] && sounds[name](); } catch { /* autoplay bloqué : tant pis */ } } }

  // ------------------------------------------------ toasts
  function toast(html, cls = '', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.innerHTML = html;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
    return el;
  }

  // ------------------------------------------------ confettis
  const canvas = document.getElementById('confetti');
  const cctx = canvas.getContext('2d');
  let particles = [];
  let rafId = null;
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  addEventListener('resize', resize); resize();
  const COLORS = ['#eab308', '#8b5cf6', '#34d399', '#f87171', '#60a5fa', '#facc15'];
  function confetti(count = 120, { spread = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.6 * spread,
        y: -20 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 5,
        vy: 2.5 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.25,
        w: 7 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        color: COLORS[i % COLORS.length],
        life: 240 + Math.random() * 80,
      });
    }
    if (!rafId) loop();
  }
  function loop() {
    rafId = requestAnimationFrame(loop);
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0 && p.y < canvas.height + 30);
    if (!particles.length) { cancelAnimationFrame(rafId); rafId = null; return; }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.045; p.rot += p.vr; p.life--;
      cctx.save();
      cctx.translate(p.x, p.y); cctx.rotate(p.rot);
      cctx.globalAlpha = Math.min(1, p.life / 60);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cctx.restore();
    }
  }

  // ------------------------------------------------ modales de célébration
  function celebrationModal({ emoji, title, sub, btn = 'Continuer' }) {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal celebration">
      <div class="c-emoji">${emoji}</div>
      <h2>${title}</h2>
      <p class="muted">${sub || ''}</p>
      <p style="margin-top:16px"><button class="primary big">${btn}</button></p>
    </div>`;
    wrap.querySelector('button').onclick = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    root.appendChild(wrap);
  }

  // ------------------------------------------------ API publique
  return {
    play, toast, confetti,
    xp(amount) {
      if (!amount) return;
      toast(`⚡ +${amount} XP`, 'xp', 2200);
      play('coin');
    },
    quest(q) {
      toast(`${q.emoji} Quête accomplie : <b>${q.label}</b> · +${q.bonus} XP`, 'quest', 4200);
      play('quest');
      confetti(50);
    },
    badge(b) {
      celebrationModal({ emoji: b.emoji, title: `Badge débloqué !`, sub: `<b>${b.name}</b> : ${b.desc} (+${b.xp} XP)` });
      play('badge');
      confetti(90);
    },
    levelUp(level) {
      celebrationModal({ emoji: '🆙', title: `Niveau ${level.level} !`, sub: `Tu es maintenant <b>${level.title}</b>.` });
      play('level');
      confetti(140);
    },
    facture(boss) {
      celebrationModal({
        emoji: '💰',
        title: `FACTURE ${boss.count}/${boss.goal} !`,
        sub: boss.done ? '' : `Encore ${boss.goal - boss.count} pour terrasser le boss. CA facturé : ${Math.round(boss.revenue).toLocaleString('fr-FR')} €`,
      });
      play('cash');
      confetti(160);
    },
    bossDown(boss) {
      celebrationModal({
        emoji: '🏆',
        title: 'BOSS VAINCU !',
        sub: `<b>${boss.count} factures déclenchées</b> : ${Math.round(boss.revenue).toLocaleString('fr-FR')} € facturés. GG. On monte l'objectif ?`,
        btn: 'LÉGENDAIRE',
      });
      play('boss');
      confetti(300, { spread: 1.4 });
      setTimeout(() => confetti(200), 700);
      setTimeout(() => confetti(200), 1400);
    },
    error(msg) {
      toast(`⚠️ ${msg}`, 'err', 6500);
      play('err');
    },
  };
})();
