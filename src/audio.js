// Tiny WebAudio sound effects: clinks, knocks and thuds, no files needed.
export class Sound {
	constructor() {
		this.ctx = null;
		this.muted = false;
		try {
			this.muted = localStorage.getItem('sirtet.muted') === '1';
		} catch {
			// storage unavailable: keep the default
		}
	}

	unlock() {
		if (this.ctx) {
			if (this.ctx.state === 'suspended') this.ctx.resume();
			return;
		}
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		this.ctx = new AC();
		this.master = this.ctx.createGain();
		this.master.gain.value = 0.35;
		this.master.connect(this.ctx.destination);
	}

	toggle() {
		this.muted = !this.muted;
		try {
			localStorage.setItem('sirtet.muted', this.muted ? '1' : '0');
		} catch {
			// ignore
		}
		return this.muted;
	}

	tone(freq, dur, { type = 'sine', vol = 0.5, at = 0, slide = 0 } = {}) {
		if (!this.ctx || this.muted) return;
		const t = this.ctx.currentTime + at;
		const o = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g);
		g.connect(this.master);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	noise(dur, { vol = 0.4, at = 0, freq = 800 } = {}) {
		if (!this.ctx || this.muted) return;
		const t = this.ctx.currentTime + at;
		const len = Math.floor(this.ctx.sampleRate * dur);
		const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
		const d = buf.getChannelData(0);
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		const f = this.ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = freq;
		const g = this.ctx.createGain();
		g.gain.value = vol;
		src.connect(f);
		f.connect(g);
		g.connect(this.master);
		src.start(t);
	}

	play(e) {
		switch (e.t) {
			case 'store': {
				const base = 880 * Math.pow(2, Math.min(e.n - 1, 8) / 12);
				this.tone(base, 0.18, { type: 'triangle', vol: 0.45 });
				this.tone(base * 1.5, 0.25, { type: 'sine', vol: 0.25, at: 0.04 });
				if (e.neat) this.tone(base * 2, 0.2, { type: 'sine', vol: 0.18, at: 0.1 });
				break;
			}
			case 'sink':
				this.tone(520, 0.1, { type: 'sine', vol: 0.12, slide: 0.6 });
				break;
			case 'empty':
				[784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.3, at: i * 0.07 }));
				break;
			case 'reject':
				this.tone(220, 0.25, { type: 'square', vol: 0.15, slide: 0.5 });
				break;
			case 'junk':
				this.noise(0.25, { vol: 0.6, freq: 500 });
				this.tone(90, 0.2, { type: 'sine', vol: 0.5 });
				break;
			case 'drawer':
				[1318, 1568, 1760, 2093].forEach((f, i) => this.tone(f, 0.15, { type: 'triangle', vol: 0.3, at: i * 0.05 }));
				break;
			case 'door':
				this.noise(0.08, { vol: 0.5, freq: 1200 });
				this.tone(160, 0.12, { type: 'sine', vol: 0.5 });
				this.tone(660, 0.2, { type: 'triangle', vol: 0.2, at: 0.1 });
				break;
			case 'level':
				[523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', vol: 0.3, at: i * 0.08 }));
				break;
			case 'rotate':
				this.tone(1400, 0.04, { type: 'sine', vol: 0.12 });
				break;
			case 'bump':
				this.tone(140, 0.05, { type: 'sine', vol: 0.2 });
				break;
			case 'launch':
				this.tone(300, 0.25, { type: 'sine', vol: 0.12, slide: 2.5 });
				break;
			case 'row':
				this.noise(0.12, { vol: 0.15, freq: 300 });
				break;
			case 'floor':
				this.tone(e.y === 0 ? 990 : 740, 0.05, { type: 'sine', vol: 0.08 });
				break;
			case 'over':
				[392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.3, at: i * 0.15 }));
				break;
			default:
		}
	}
}
