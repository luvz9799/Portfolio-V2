/* Stand-in for the YouTube IFrame API in the portfolio demo.
 * Same methods and events the LMS uses (getCurrentTime, seekTo, getPlaybackRate, onStateChange…),
 * so the app's real seek lock, speed lock and checkpoint pauses run unchanged against it.
 * The "video" is a 60-second timeline with slides; try dragging ahead or speeding up. */
(function () {
  'use strict';
  const State = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const SLIDES = {
    demoVideo01: ['Who we are', 'Our colonies in Jhalawar and Kota', 'Plot sizes and pricing', 'Documents a buyer receives'],
    demoVideo02: ['Why needs come first', 'Budget, location, plot size', 'Listening for the real reason', 'Summarise and confirm'],
    demoVideo03: ['Before the visit', 'At the site', 'Handling the family', 'After the visit'],
    demoVideo04: ['Reading buying signals', 'Token and booking form', 'Documents checklist', 'Handing over to accounts'],
  };
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const css = `
  .fyt{position:absolute;inset:0;display:flex;flex-direction:column;color:#fff;font-family:inherit;background:radial-gradient(120% 90% at 20% 10%,#1f4d74 0%,#0B1424 60%);user-select:none}
  .fyt-stage{flex:1;display:grid;place-items:center;text-align:center;padding:16px;cursor:pointer}
  .fyt-kicker{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.6}
  .fyt-title{font-size:clamp(16px,3.4vw,26px);font-weight:700;margin-top:6px}
  .fyt-big{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center;margin:0 auto 10px;font-size:26px}
  .fyt-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:linear-gradient(transparent,rgba(0,0,0,.55))}
  .fyt-btn{background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:6px;padding:5px 9px;font:inherit;font-size:12px;cursor:pointer}
  .fyt-track{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.22);position:relative;cursor:pointer}
  .fyt-fill{position:absolute;inset:0 auto 0 0;border-radius:3px;background:#E5484D}
  .fyt-time{font-size:12px;font-variant-numeric:tabular-nums;opacity:.85;min-width:72px;text-align:right}
  .fyt-tag{position:absolute;top:8px;left:10px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;background:rgba(0,0,0,.35);padding:3px 7px;border-radius:4px;opacity:.8}`;
  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

  class Player {
    constructor(elId, opts) {
      const host = typeof elId === 'string' ? document.getElementById(elId) : elId;
      this.o = opts || {};
      this.id = this.o.videoId;
      this.dur = 60;
      this.t = Math.min(Number(this.o.playerVars?.start || 0), this.dur);
      this.rate = 1;
      this.state = State.CUED;
      this.slides = SLIDES[this.id] || ['Training video'];
      this.el = document.createElement('div');
      this.el.className = 'fyt';
      this.el.innerHTML = `<span class="fyt-tag">Demo player</span>
        <div class="fyt-stage"><div><div class="fyt-big">▶</div><div class="fyt-kicker"></div><div class="fyt-title"></div></div></div>
        <div class="fyt-bar"><button class="fyt-btn fyt-play" type="button" aria-label="Play">▶</button>
        <div class="fyt-track" title="Click to jump"><div class="fyt-fill"></div></div>
        <span class="fyt-time"></span><button class="fyt-btn fyt-rate" type="button" aria-label="Playback speed">1×</button></div>`;
      host.replaceWith(this.el);
      const toggle = () => (this.state === State.PLAYING ? this.pauseVideo() : this.playVideo());
      this.el.querySelector('.fyt-stage').onclick = toggle;
      this.el.querySelector('.fyt-play').onclick = toggle;
      this.el.querySelector('.fyt-track').onclick = e => {
        const r = e.currentTarget.getBoundingClientRect();
        this.seekTo(((e.clientX - r.left) / r.width) * this.dur, true);
      };
      this.el.querySelector('.fyt-rate').onclick = () => this.setPlaybackRate(this.rate >= 2 ? 1 : this.rate + 0.5);
      this.timer = setInterval(() => this.step(), 200);
      this.draw();
      setTimeout(() => this.o.events?.onReady?.({ target: this }), 50);
    }
    emit(name, data) { this.o.events?.[name]?.({ target: this, data }); }
    setState(s) { if (this.state !== s) { this.state = s; this.emit('onStateChange', s); } this.draw(); }
    step() {
      if (this.state !== State.PLAYING) return;
      this.t = Math.min(this.dur, this.t + 0.2 * this.rate);
      if (this.t >= this.dur) this.setState(State.ENDED);
      this.draw();
    }
    draw() {
      const i = Math.min(this.slides.length - 1, Math.floor((this.t / this.dur) * this.slides.length));
      const q = s => this.el.querySelector(s);
      q('.fyt-big').style.display = this.state === State.PLAYING ? 'none' : '';
      q('.fyt-big').textContent = this.state === State.ENDED ? '↺' : '▶';
      q('.fyt-kicker').textContent = this.state === State.PLAYING || this.t > 0 ? `Part ${i + 1} of ${this.slides.length}` : 'Training video';
      q('.fyt-title').textContent = this.slides[i];
      q('.fyt-play').textContent = this.state === State.PLAYING ? '❚❚' : '▶';
      q('.fyt-fill').style.width = `${(this.t / this.dur) * 100}%`;
      q('.fyt-time').textContent = `${fmt(this.t)} / ${fmt(this.dur)}`;
      q('.fyt-rate').textContent = `${this.rate}×`;
    }
    playVideo() { if (this.state === State.ENDED) this.t = 0; this.setState(State.PLAYING); }
    pauseVideo() { if (this.state === State.PLAYING) this.setState(State.PAUSED); }
    seekTo(s) { this.t = Math.max(0, Math.min(this.dur, Number(s) || 0)); this.draw(); }
    getCurrentTime() { return this.t; }
    getDuration() { return this.dur; }
    getPlayerState() { return this.state; }
    getPlaybackRate() { return this.rate; }
    setPlaybackRate(r) { this.rate = r; this.draw(); this.emit('onPlaybackRateChange', r); }
    destroy() { clearInterval(this.timer); this.el.remove(); }
  }
  window.YT = { Player, PlayerState: State };
})();
