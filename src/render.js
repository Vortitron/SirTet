// Canvas 2D renderer. Everything is drawn in code: crockery, cupboards,
// the worktop and the dishwasher itself.
import { W, H, ZONE, FLOORS, DRAWER_X, DRAWER_W, PER_LEVEL } from './game.js';
import { TYPE_COLOURS, size, baseShape } from './pieces.js';
import { JUNK } from './stack.js';
import { scrollFor, judge, fit, toLocal } from './cupboard.js';
import { SIDE, computeLayout, cupboardRect } from './layout.js';

const DISHES = [
	{ bg: '#eef2f8', fg: '#4f74b3' }, // plate
	{ bg: '#f7e2d6', fg: '#c4513a' }, // mug
	{ bg: '#e3f0dc', fg: '#4f8f42' }, // bowl
	{ bg: '#dff1f3', fg: '#2f8d99' }, // glass
	{ bg: '#f6ecc9', fg: '#a8701c' }, // saucepan
];
const JUNK_STYLE = { bg: '#8d9196', fg: '#5c6066' };

const WOOD = '#b9824f';
const WOOD_LIGHT = '#d29a63';
const WOOD_DARK = '#7a5232';

function shade(hex, amt) {
	const n = parseInt(hex.slice(1), 16);
	const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
	const r = f(n >> 16);
	const g = f((n >> 8) & 255);
	const b = f(n & 255);
	return `rgb(${r},${g},${b})`;
}

const fmt = (n) => Number(n).toLocaleString('en-GB');

function rr(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

export class Renderer {
	constructor(canvas, game) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.game = game;
		this.ghosts = [];
		this.vis = new Map();
		this.scroll = [0, 0, 0, 0, 0, 0];
		this.particles = [];
		this.popups = [];
		this.shake = 0;
		this.time = 0;
		this.flashRow = 0;
		this.banner = null;
	}

	setGame(game) {
		this.game = game;
		this.vis.clear();
		this.scroll = [0, 0, 0, 0, 0, 0];
		this.particles = [];
		this.popups = [];
	}

	resize(vw, vh, dpr) {
		this.dpr = dpr;
		this.canvas.width = Math.round(vw * dpr);
		this.canvas.height = Math.round(vh * dpr);
		this.canvas.style.width = vw + 'px';
		this.canvas.style.height = vh + 'px';
		this.L = computeLayout(vw, vh);
		this.bg = null;
	}

	// ---- events -----------------------------------------------------------

	onEvent(e) {
		const L = this.L;
		const c = L.c;
		const g = this.game;
		if (e.t === 'store') {
			const r = cupboardRect(L, e.cup);
			const col = TYPE_COLOURS[e.type];
			const x = r.left ? r.x + r.w - c : r.x + c;
			this.burst(x, r.y + r.h / 2, col, 14);
			this.popup(`+${fmt(e.points)}`, x, r.y + r.h / 2, col);
			const below = r.y + r.h + c * 0.6;
			if (e.first) this.popup(`${e.type} cupboard`, r.x + r.w / 2, below, '#fff', 0.8);
			else if (e.neat) this.popup('Neat!', r.x + r.w / 2, below, '#9be27a', 0.9);
			if (e.streak >= 3 && e.streak % 3 === 0) this.popup(`Tidy run x${e.streak}!`, L.colX + L.colW / 2, L.colY + (ZONE + 1.5) * c, '#ffd36e', 1.1);
		} else if (e.t === 'reject') {
			this.shake = 0.25;
			const msg = { wrong: 'Wrong cupboard!', taken: `${e.type} already has a cupboard`, gap: 'Wrong way round!', patience: 'Too slow!' }[e.reason];
			this.popup(msg, L.colX + L.colW / 2, L.colY + (e.y + 3) * c, '#ff8a80', 1.0);
		} else if (e.t === 'junk') {
			this.shake = 0.35;
			this.flashRow = 0.4;
		} else if (e.t === 'drawer') {
			const x = L.colX + (DRAWER_X + DRAWER_W / 2) * c;
			this.burst(x, L.topY + c / 2, '#ffffff', 26);
			this.popup(`Cutlery away! +${e.points}`, x, L.topY + c * 2.2, '#fff6b0', 1.2);
			this.flashRow = 0.5;
		} else if (e.t === 'door') {
			const r = cupboardRect(L, e.cup);
			this.popup(`Door shut! +${fmt(e.bonus)}`, r.x + r.w / 2, r.y + r.h / 2, '#fff6b0', 1.1);
		} else if (e.t === 'empty') {
			this.banner = { text: 'Dishwasher empty!', sub: `+${fmt(e.bonus)}`, t: 2.4 };
			this.burst(L.colX + L.colW / 2, L.bottomY - c * 2, '#bfe9ff', 40, true);
		} else if (e.t === 'level') {
			this.banner = { text: `Level ${e.level}`, t: 1.6 };
		} else if (e.t === 'wash') {
			for (const [x, y] of e.cells) this.burst(L.colX + (x + 0.5) * c, L.colY + (y + 0.5) * c, '#bfe9ff', 6, true);
		} else if (e.t === 'launch') {
			for (let i = 0; i < 6; i++) this.burst(L.colX + (e.x + 1) * c, L.colY + (e.y + 1) * c, '#cfefff', 1, true);
		}
		void g;
	}

	burst(x, y, colour, n, bubble = false) {
		const c = this.L.c;
		for (let i = 0; i < n; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = (0.5 + Math.random()) * c * (bubble ? 2 : 5);
			this.particles.push({
				x,
				y,
				vx: Math.cos(a) * s,
				vy: Math.sin(a) * s - (bubble ? c * 2 : 0),
				life: 0.5 + Math.random() * 0.5,
				max: 1,
				r: c * (bubble ? 0.12 + Math.random() * 0.15 : 0.06 + Math.random() * 0.08),
				colour,
				bubble,
			});
		}
	}

	popup(text, x, y, colour, life = 0.9) {
		this.popups.push({ text, x, y, colour, life, max: life });
	}

	// ---- frame ------------------------------------------------------------

	frame(dt) {
		this.time += dt;
		const { ctx, L, game } = this;
		if (!L) return;
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		if (!this.bg) this.bg = this.makeBackground();
		ctx.drawImage(this.bg, 0, 0, L.vw, L.vh);

		ctx.save();
		if (this.shake > 0) {
			this.shake -= dt;
			const m = this.shake * L.c * 0.6;
			ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
		}
		this.drawColumn();
		this.drawStack(dt);
		this.ghosts = this.ghostTargets();
		this.drawCupboards(dt);
		this.drawGhost();
		this.drawWorktop();
		this.drawFlying(dt);
		this.drawKickPlate();
		this.drawEffects(dt);
		ctx.restore();
		this.drawHud();
		if (this.banner) {
			this.banner.t -= dt;
			if (this.banner.t <= 0) this.banner = null;
			else this.drawBanner();
		}
		if (game.mode === 'paused') this.drawPaused();
	}

	makeBackground() {
		const L = this.L;
		const cv = document.createElement('canvas');
		cv.width = Math.round(L.vw * this.dpr);
		cv.height = Math.round(L.vh * this.dpr);
		const ctx = cv.getContext('2d');
		ctx.scale(this.dpr, this.dpr);
		// Kitchen wall: cream tiles everywhere outside the board.
		ctx.fillStyle = '#2b2622';
		ctx.fillRect(0, 0, L.vw, L.vh);
		const t = L.c * 1.0;
		const startX = L.colX % t;
		const startY = L.colY % t;
		for (let y = startY - t; y < L.vh; y += t) {
			for (let x = startX - t; x < L.vw; x += t) {
				const inBoard = x >= L.ox - 1 && x < L.ox + L.width && y >= L.oy - 1 && y < L.oy + L.height;
				ctx.fillStyle = inBoard ? '#eee4d3' : '#3a332d';
				ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
				if (inBoard) {
					ctx.fillStyle = 'rgba(255,255,255,0.35)';
					ctx.fillRect(x + 2, y + 2, t * 0.45, t * 0.12);
				}
			}
		}
		// A blue accent row of tiles, because every kitchen has one.
		ctx.fillStyle = '#7fa7c9';
		const accentY = L.colY + (ZONE + 3) * L.c;
		for (let x = startX - t; x < L.vw; x += t) {
			if (x >= L.ox - 1 && x < L.ox + L.width) ctx.fillRect(x + 1, accentY + 1, t - 2, t - 2);
		}
		this.drawDecor(ctx);
		return cv;
	}

	drawDecor(ctx) {
		const L = this.L;
		const c = L.c;
		// Left: a potted herb on a little shelf.
		const sx = L.ox + c * 0.4;
		const sy = L.bottomY - c * 2.2;
		ctx.fillStyle = WOOD_DARK;
		ctx.fillRect(L.ox, sy + c * 1.4, SIDE * c, c * 0.25);
		ctx.fillStyle = '#c0643f';
		ctx.beginPath();
		ctx.moveTo(sx + c * 0.6, sy + c * 0.5);
		ctx.lineTo(sx + c * 2.2, sy + c * 0.5);
		ctx.lineTo(sx + c * 1.95, sy + c * 1.4);
		ctx.lineTo(sx + c * 0.85, sy + c * 1.4);
		ctx.fill();
		ctx.fillStyle = '#5a9a4a';
		for (let i = 0; i < 6; i++) {
			const a = -Math.PI / 2 + (i - 2.5) * 0.35;
			ctx.beginPath();
			ctx.ellipse(sx + c * 1.4 + Math.cos(a) * c * 0.5, sy + c * 0.3 + Math.sin(a) * c * 0.5, c * 0.18, c * 0.42, a + Math.PI / 2, 0, Math.PI * 2);
			ctx.fill();
		}
		// Right: a tea towel on a rail.
		const tx = L.rightX + c * 0.9;
		const ty = L.colY + (ZONE + 5) * c;
		ctx.fillStyle = '#9aa3ab';
		ctx.fillRect(L.rightX + c * 0.4, ty, c * 3.2, c * 0.18);
		ctx.fillStyle = '#f3f0ea';
		rr(ctx, tx, ty + c * 0.1, c * 2.2, c * 3.2, c * 0.15);
		ctx.fill();
		ctx.fillStyle = '#d0574a';
		for (let i = 0; i < 3; i++) ctx.fillRect(tx, ty + c * (0.6 + i * 0.35), c * 2.2, c * 0.12);
		ctx.fillRect(tx, ty + c * 2.6, c * 2.2, c * 0.12);
	}

	cellXY(x, y) {
		const L = this.L;
		return [L.colX + x * L.c, L.colY + y * L.c];
	}

	drawColumn() {
		const { ctx, L, game } = this;
		const c = L.c;
		const grad = ctx.createLinearGradient(0, L.colY, 0, L.bottomY);
		grad.addColorStop(0, '#0d0f12');
		grad.addColorStop(1, '#1a1d22');
		ctx.fillStyle = grad;
		ctx.fillRect(L.colX, L.colY, L.colW, L.colH);
		// Dishwasher rack wires.
		ctx.strokeStyle = 'rgba(160,175,190,0.07)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 1; x < W; x++) {
			ctx.moveTo(L.colX + x * c + 0.5, L.colY + ZONE * c);
			ctx.lineTo(L.colX + x * c + 0.5, L.bottomY);
		}
		for (let y = ZONE; y < H; y += 2) {
			ctx.moveTo(L.colX, L.colY + y * c + 0.5);
			ctx.lineTo(L.rightX, L.colY + y * c + 0.5);
		}
		ctx.stroke();
		// Floor marks in the cupboard zone.
		const p = game.active;
		for (const fy of FLOORS) {
			const lit = p && p.y === fy && (p.state === 'dwell' || p.state === 'ceiling');
			const y = L.colY + fy * c;
			ctx.fillStyle = lit ? 'rgba(255,240,180,0.9)' : 'rgba(255,255,255,0.14)';
			ctx.fillRect(L.colX, y + c * 0.1, c * 0.12, c * 1.8);
			ctx.fillRect(L.rightX - c * 0.12, y + c * 0.1, c * 0.12, c * 1.8);
			if (fy > 0) {
				ctx.fillStyle = 'rgba(255,255,255,0.05)';
				ctx.fillRect(L.colX, y - 1, L.colW, 2);
			}
		}
		// The full line: dishes must not reach the cupboards.
		const danger = game.danger();
		const ly = L.colY + ZONE * c;
		ctx.save();
		ctx.setLineDash([c * 0.3, c * 0.25]);
		const pulse = 0.5 + 0.5 * Math.sin(this.time * 8);
		ctx.strokeStyle = danger > 0 ? `rgba(255,90,80,${0.4 + 0.6 * danger * pulse})` : 'rgba(255,120,110,0.25)';
		ctx.lineWidth = Math.max(1, c * 0.08);
		ctx.beginPath();
		ctx.moveTo(L.colX, ly);
		ctx.lineTo(L.rightX, ly);
		ctx.stroke();
		ctx.restore();
		if (danger > 0) {
			const g2 = ctx.createLinearGradient(0, ly, 0, ly + c * 4);
			g2.addColorStop(0, `rgba(255,60,50,${0.35 * danger * (0.6 + 0.4 * pulse)})`);
			g2.addColorStop(1, 'rgba(255,60,50,0)');
			ctx.fillStyle = g2;
			ctx.fillRect(L.colX, ly, L.colW, c * 4);
		}
		if (this.flashRow > 0) {
			ctx.fillStyle = `rgba(255,255,255,${this.flashRow * 0.4})`;
			ctx.fillRect(L.colX, L.bottomY - c * 2, L.colW, c * 2);
		}
		// Column walls.
		ctx.fillStyle = '#5d636b';
		ctx.fillRect(L.colX - c * 0.08, L.colY + ZONE * c, c * 0.08, L.colH - ZONE * c);
		ctx.fillRect(L.rightX, L.colY + ZONE * c, c * 0.08, L.colH - ZONE * c);
	}

	// One square of crockery.
	drawCell(x, y, s, style, kind, opts = {}) {
		const ctx = this.ctx;
		const pad = s * 0.06;
		const bg = style.bg;
		rr(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2, s * 0.18);
		ctx.fillStyle = bg;
		ctx.fill();
		if (opts.outline) {
			ctx.lineWidth = Math.max(1, s * 0.07);
			ctx.strokeStyle = opts.outline;
			ctx.stroke();
		}
		ctx.fillStyle = 'rgba(255,255,255,0.35)';
		rr(ctx, x + pad * 2, y + pad * 2, s * 0.55, s * 0.12, s * 0.06);
		ctx.fill();
		this.drawIcon(x, y, s, kind, style.fg, opts.cutlery);
	}

	drawIcon(x, y, s, kind, fg, cutlery) {
		const ctx = this.ctx;
		ctx.save();
		ctx.translate(x, y);
		ctx.strokeStyle = fg;
		ctx.fillStyle = fg;
		ctx.lineWidth = Math.max(1, s * 0.07);
		ctx.lineCap = 'round';
		if (cutlery !== undefined) {
			const k = cutlery % 3;
			ctx.beginPath();
			if (k === 0) {
				// fork
				ctx.moveTo(s * 0.5, s * 0.82);
				ctx.lineTo(s * 0.5, s * 0.45);
				for (const dx of [-0.12, 0, 0.12]) {
					ctx.moveTo(s * (0.5 + dx), s * 0.45);
					ctx.lineTo(s * (0.5 + dx), s * 0.2);
				}
				ctx.moveTo(s * 0.38, s * 0.45);
				ctx.lineTo(s * 0.62, s * 0.45);
				ctx.stroke();
			} else if (k === 1) {
				// knife
				ctx.moveTo(s * 0.5, s * 0.82);
				ctx.lineTo(s * 0.5, s * 0.55);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(s * 0.44, s * 0.55);
				ctx.lineTo(s * 0.44, s * 0.18);
				ctx.quadraticCurveTo(s * 0.62, s * 0.3, s * 0.58, s * 0.55);
				ctx.closePath();
				ctx.fill();
			} else {
				// spoon
				ctx.moveTo(s * 0.5, s * 0.82);
				ctx.lineTo(s * 0.5, s * 0.48);
				ctx.stroke();
				ctx.beginPath();
				ctx.ellipse(s * 0.5, s * 0.33, s * 0.13, s * 0.17, 0, 0, Math.PI * 2);
				ctx.fill();
			}
		} else if (kind === JUNK) {
			ctx.beginPath();
			ctx.arc(s * 0.5, s * 0.5, s * 0.3, 0, Math.PI * 2);
			ctx.stroke();
			ctx.strokeStyle = '#3f4247';
			ctx.beginPath();
			ctx.moveTo(s * 0.3, s * 0.25);
			ctx.lineTo(s * 0.48, s * 0.48);
			ctx.lineTo(s * 0.4, s * 0.6);
			ctx.lineTo(s * 0.62, s * 0.8);
			ctx.stroke();
			ctx.fillStyle = 'rgba(120,90,40,0.5)';
			ctx.beginPath();
			ctx.arc(s * 0.62, s * 0.4, s * 0.08, 0, Math.PI * 2);
			ctx.fill();
		} else if (kind === 0) {
			ctx.beginPath();
			ctx.arc(s * 0.5, s * 0.5, s * 0.32, 0, Math.PI * 2);
			ctx.stroke();
			ctx.lineWidth = Math.max(1, s * 0.04);
			ctx.beginPath();
			ctx.arc(s * 0.5, s * 0.5, s * 0.17, 0, Math.PI * 2);
			ctx.stroke();
		} else if (kind === 1) {
			rr(ctx, s * 0.24, s * 0.3, s * 0.4, s * 0.46, s * 0.06);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(s * 0.66, s * 0.52, s * 0.11, -Math.PI / 2, Math.PI / 2);
			ctx.stroke();
		} else if (kind === 2) {
			ctx.beginPath();
			ctx.moveTo(s * 0.18, s * 0.42);
			ctx.lineTo(s * 0.82, s * 0.42);
			ctx.arc(s * 0.5, s * 0.42, s * 0.32, 0, Math.PI);
			ctx.fill();
			ctx.fillRect(s * 0.38, s * 0.72, s * 0.24, s * 0.08);
		} else if (kind === 4) {
			// saucepan: a pot with a long handle and a lid knob
			rr(ctx, s * 0.2, s * 0.4, s * 0.42, s * 0.36, s * 0.08);
			ctx.fill();
			ctx.beginPath();
			ctx.moveTo(s * 0.62, s * 0.48);
			ctx.lineTo(s * 0.86, s * 0.4);
			ctx.stroke();
			ctx.fillRect(s * 0.16, s * 0.33, s * 0.5, s * 0.06);
			ctx.beginPath();
			ctx.arc(s * 0.41, s * 0.29, s * 0.05, 0, Math.PI * 2);
			ctx.fill();
		} else {
			ctx.beginPath();
			ctx.moveTo(s * 0.3, s * 0.2);
			ctx.lineTo(s * 0.7, s * 0.2);
			ctx.lineTo(s * 0.62, s * 0.8);
			ctx.lineTo(s * 0.38, s * 0.8);
			ctx.closePath();
			ctx.stroke();
			ctx.globalAlpha = 0.5;
			ctx.beginPath();
			ctx.moveTo(s * 0.34, s * 0.48);
			ctx.lineTo(s * 0.66, s * 0.48);
			ctx.lineTo(s * 0.62, s * 0.8);
			ctx.lineTo(s * 0.38, s * 0.8);
			ctx.closePath();
			ctx.fill();
		}
		ctx.restore();
	}

	drawStack() {
		const { ctx, L, game } = this;
		const c = L.c;
		const ready = new Set();
		for (const cand of game.candidates) for (const [x, y] of cand.cells) ready.add(x + ',' + y);
		ctx.save();
		ctx.beginPath();
		ctx.rect(L.colX, L.colY, L.colW, L.colH);
		ctx.clip();
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const cell = game.grid[y][x];
				if (!cell) continue;
				const style = cell.k === JUNK ? JUNK_STYLE : DISHES[cell.k % DISHES.length];
				let [px, py] = this.cellXY(x + (cell.fx || 0), y + (cell.fy || 0));
				const isReady = ready.has(x + ',' + y);
				if (isReady) {
					const w = Math.sin(this.time * 30 + x) * c * 0.05;
					px += w;
					ctx.save();
					ctx.shadowColor = '#ffffff';
					ctx.shadowBlur = c * 0.6;
				}
				this.drawCell(px, py, c, style, cell.k, isReady ? { outline: '#ffffff' } : {});
				if (isReady) ctx.restore();
			}
		}
		ctx.restore();
	}

	drawCupboards(dt) {
		const { ctx, L, game } = this;
		const c = L.c;
		const active = game.active;
		const home = active ? game.homeOf(active.type) : -1;
		for (let i = 0; i < 6; i++) {
			const cup = game.cupboards[i];
			const r = cupboardRect(L, i);
			// Carcass and interior.
			ctx.fillStyle = WOOD_DARK;
			ctx.fillRect(r.x, r.y, r.w, r.h);
			const ig = ctx.createLinearGradient(r.left ? r.x : r.x + r.w, 0, r.left ? r.x + r.w : r.x, 0);
			ig.addColorStop(0, '#2a1d14');
			ig.addColorStop(1, '#4a3424');
			ctx.fillStyle = ig;
			ctx.fillRect(r.x, r.y + c * 0.06, r.w, r.h - c * 0.18);
			if (cup.type) {
				ctx.fillStyle = TYPE_COLOURS[cup.type];
				ctx.globalAlpha = 0.14;
				ctx.fillRect(r.x, r.y, r.w, r.h);
				ctx.globalAlpha = 1;
			}
			// Back-wall label: which shape lives here (hidden behind contents).
			this.drawLabel(r, cup);
			// Contents, scrolling out of the back as it fills.
			// Slide the contents back to make room for a piece lined up
			// with this cupboard, so its landing preview is in view.
			let target = scrollFor(cup, SIDE);
			const gh = this.ghosts.find((t) => t.idx === i && t.room);
			if (gh) target = Math.max(target, gh.room - SIDE);
			this.scroll[i] += (target - this.scroll[i]) * Math.min(1, dt * 8);
			if (cup.items.length === 0) this.scroll[i] = 0;
			ctx.save();
			ctx.beginPath();
			ctx.rect(r.x, r.y, r.w, r.h);
			ctx.clip();
			for (const item of cup.items) {
				if (item.slide) item.slide = Math.max(0, item.slide - dt * 5);
				const col = TYPE_COLOURS[item.type];
				const style = { bg: col, fg: shade(col, -0.28) };
				for (const [u, row] of item.cells) {
					const d = u - this.scroll[i] + (item.slide || 0) * 3;
					const px = r.left ? r.x + d * c : r.x + r.w - (d + 1) * c;
					this.drawCell(px, r.y + row * c, c, style, 0);
				}
			}
			ctx.restore();
			// Shelf.
			ctx.fillStyle = WOOD_LIGHT;
			ctx.fillRect(r.x, r.y + r.h - c * 0.14, r.w, c * 0.14);
			// Door.
			let doorP = 0;
			if (cup.door === 'closing') doorP = Math.min(1, cup.doorT / 0.25);
			else if (cup.door === 'closed') doorP = 1;
			else if (cup.door === 'opening') doorP = 1 - Math.min(1, cup.doorT / 0.3);
			if (doorP > 0) this.drawDoor(r, doorP);
			else {
				// The open door, seen edge-on at the opening.
				ctx.fillStyle = cup.type ? TYPE_COLOURS[cup.type] : WOOD_LIGHT;
				const ex = r.left ? r.x + r.w - c * 0.18 : r.x;
				ctx.fillRect(ex, r.y, c * 0.18, r.h);
			}
			// Hints.
			if (active && cup.door === 'open') {
				const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
				let col = null;
				if (home === i) col = TYPE_COLOURS[active.type];
				else if (home === -1 && cup.type === null && active.type !== 'I') col = 'rgba(255,255,255,0.55)';
				if (col) {
					ctx.save();
					ctx.strokeStyle = col;
					ctx.globalAlpha = home === i ? 0.5 + 0.5 * pulse : 0.25 + 0.3 * pulse;
					ctx.lineWidth = Math.max(2, c * 0.12);
					if (home !== i) ctx.setLineDash([c * 0.25, c * 0.2]);
					ctx.strokeRect(r.x + c * 0.08, r.y + c * 0.08, r.w - c * 0.16, r.h - c * 0.16);
					ctx.restore();
				}
			}
			if (cup.flash > 0) {
				ctx.fillStyle = `rgba(255,70,60,${cup.flash})`;
				ctx.fillRect(r.x, r.y, r.w, r.h);
			}
		}
		// Cupboard dividers.
		ctx.fillStyle = WOOD;
		for (const left of [true, false]) {
			const x = left ? L.ox : L.rightX;
			for (let f = 0; f <= 3; f++) ctx.fillRect(x, L.colY + f * 2 * c - c * 0.05, SIDE * c, c * 0.1);
		}
		// A little brass label on each shelf edge: how many pieces are on
		// it (older ones have slid out of view). The door bonus grows with
		// the square of this.
		for (let i = 0; i < 6; i++) {
			const cup = game.cupboards[i];
			if (cup.items.length < 2 || cup.door !== 'open') continue;
			const r = cupboardRect(L, i);
			const n = cup.items.length;
			const fs = Math.max(8, Math.round(c * 0.42));
			ctx.font = `800 ${fs}px system-ui, sans-serif`;
			const txt = `×${n}`;
			const tw = ctx.measureText(txt).width + c * 0.24;
			const th = fs + c * 0.06;
			const bx = r.left ? r.x + c * 0.2 : r.x + r.w - c * 0.2 - tw;
			const by = r.y + r.h - th / 2 - c * 0.02;
			ctx.fillStyle = n >= 5 ? '#e6b84a' : '#c9a36a';
			rr(ctx, bx, by, tw, th, c * 0.1);
			ctx.fill();
			ctx.fillStyle = '#3b2c22';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(txt, bx + tw / 2, by + th / 2 + 0.5);
		}
	}

	// Landing preview: for the cupboard the active piece is lined up with
	// (its shelf, on the side it is nearer), a green outline where it would
	// come to rest, or a red one and a cross if the cupboard would send it
	// back. This is what teaches the no-gaps rule.
	ghostTargets() {
		const g = this.game;
		const p = g.active;
		if (!p || p.type === 'I' || p.y > ZONE + 1) return [];
		const { w, h } = size(p.cells);
		if (h !== 2) return [];
		let floor = -1;
		for (let f = FLOORS.length - 1; f >= 0; f--) {
			if (FLOORS[f] <= p.y) {
				floor = f;
				break;
			}
		}
		if (floor < 0) floor = FLOORS.length - 1;
		const mid = p.x + w / 2;
		const sides = mid < W / 2 ? [0] : mid > W / 2 ? [3] : [0, 3];
		return sides.map((s) => {
			const idx = s + floor;
			const cup = g.cupboards[idx];
			const verdict = judge(g.cupboards, idx, p.type, p.cells);
			// How deep the shelf would be with this piece in it.
			let room = 0;
			if (verdict === 'store' || verdict === 'gap') {
				const f = fit(cup, p.cells);
				for (const [u] of toLocal(p.cells, cup.side)) room = Math.max(room, u + f.offset + 1);
			}
			return { idx, verdict, room };
		});
	}

	drawGhost() {
		const { ctx, L, game } = this;
		const c = L.c;
		const p = game.active;
		for (const { idx, verdict } of this.ghosts) {
			if (verdict === 'blocked') continue;
			const cup = game.cupboards[idx];
			const r = cupboardRect(L, idx);
			const ok = verdict === 'store';
			const pulse = 0.65 + 0.35 * Math.sin(this.time * 7);
			if (verdict === 'store' || verdict === 'gap') {
				const f = fit(cup, p.cells);
				const local = toLocal(p.cells, cup.side);
				const scroll = cup.items.length ? this.scroll[idx] : 0;
				ctx.save();
				ctx.beginPath();
				ctx.rect(r.x, r.y, r.w, r.h);
				ctx.clip();
				ctx.globalAlpha = pulse;
				ctx.fillStyle = ok ? 'rgba(120,230,120,0.32)' : 'rgba(255,90,70,0.3)';
				ctx.strokeStyle = ok ? '#8ef08a' : '#ff6b5e';
				ctx.lineWidth = Math.max(2, c * 0.12);
				for (const [u, row] of local) {
					const d = u + f.offset - scroll;
					const px = r.left ? r.x + d * c : r.x + r.w - (d + 1) * c;
					ctx.fillRect(px + c * 0.08, r.y + row * c + c * 0.08, c * 0.84, c * 0.84);
					ctx.strokeRect(px + c * 0.08, r.y + row * c + c * 0.08, c * 0.84, c * 0.84);
				}
				ctx.restore();
			}
			if (!ok) {
				ctx.save();
				ctx.strokeStyle = '#ff6b5e';
				ctx.globalAlpha = 0.6 + 0.4 * pulse;
				ctx.lineWidth = Math.max(2, c * 0.16);
				ctx.lineCap = 'round';
				const m = c * 0.55;
				const cx = r.left ? r.x + r.w - c * 1.1 : r.x + c * 1.1;
				const cy = r.y + r.h / 2;
				ctx.beginPath();
				ctx.moveTo(cx - m, cy - m);
				ctx.lineTo(cx + m, cy + m);
				ctx.moveTo(cx + m, cy - m);
				ctx.lineTo(cx - m, cy + m);
				ctx.stroke();
				ctx.restore();
			}
		}
	}

	drawLabel(r, cup) {
		const { ctx, L } = this;
		const c = L.c;
		const s = c * 0.2;
		const bx = r.left ? r.x + c * 0.15 : r.x + r.w - c * 0.15 - s * 4;
		const by = r.y + r.h / 2 - s;
		if (!cup.type) {
			if (cup.items.length === 0) {
				ctx.fillStyle = 'rgba(255,255,255,0.22)';
				ctx.font = `600 ${Math.round(c * 0.42)}px system-ui, sans-serif`;
				ctx.textAlign = r.left ? 'left' : 'right';
				ctx.textBaseline = 'middle';
				ctx.fillText('free', r.left ? r.x + c * 0.2 : r.x + r.w - c * 0.2, r.y + r.h / 2 - c * 0.04);
			}
			return;
		}
		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		for (const [x, y] of baseShape(cup.type)) ctx.fillRect(bx + x * s, by + y * s, s - 1, s - 1);
	}

	drawDoor(r, p) {
		const { ctx, L } = this;
		const c = L.c;
		// Hinged at the back, swinging shut across the opening.
		const w = r.w * p;
		const x = r.left ? r.x : r.x + r.w - w;
		ctx.fillStyle = WOOD;
		ctx.fillRect(x, r.y, w, r.h);
		ctx.strokeStyle = WOOD_DARK;
		ctx.lineWidth = Math.max(1, c * 0.08);
		ctx.strokeRect(x + c * 0.25 * p, r.y + c * 0.25, Math.max(0, w - c * 0.5 * p), r.h - c * 0.5);
		ctx.fillStyle = '#e8d2a8';
		const kx = r.left ? x + w - c * 0.45 : x + c * 0.45;
		ctx.beginPath();
		ctx.arc(kx, r.y + r.h / 2, c * 0.14, 0, Math.PI * 2);
		ctx.fill();
	}

	drawWorktop() {
		const { ctx, L, game } = this;
		const c = L.c;
		const y = L.topY;
		ctx.fillStyle = '#d8b48a';
		ctx.fillRect(L.ox, y, L.width, c);
		ctx.fillStyle = '#b48d63';
		ctx.fillRect(L.ox, y + c * 0.82, L.width, c * 0.18);
		ctx.fillStyle = 'rgba(255,255,255,0.25)';
		ctx.fillRect(L.ox, y, L.width, c * 0.12);
		// Cutlery drawer above the column.
		const dx = L.colX + DRAWER_X * c;
		const open = game.drawerFlash > 0;
		const want = game.active && game.active.type === 'I';
		ctx.fillStyle = open ? '#f2d7a8' : WOOD;
		ctx.fillRect(dx, y + c * 0.1, DRAWER_W * c, c * 0.8);
		ctx.strokeStyle = WOOD_DARK;
		ctx.lineWidth = Math.max(1, c * 0.06);
		ctx.strokeRect(dx + c * 0.08, y + c * 0.16, DRAWER_W * c - c * 0.16, c * 0.68);
		ctx.fillStyle = '#e8d2a8';
		ctx.fillRect(dx + c * 1.4, y + c * 0.42, c * 1.2, c * 0.16);
		this.drawIcon(dx + c * 0.1, y + c * 0.05, c * 0.9, 0, 'rgba(90,60,30,0.6)', 0);
		this.drawIcon(dx + c * 3.0, y + c * 0.05, c * 0.9, 0, 'rgba(90,60,30,0.6)', 2);
		if (want) {
			const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
			ctx.save();
			ctx.strokeStyle = '#ffffff';
			ctx.globalAlpha = 0.4 + 0.6 * pulse;
			ctx.lineWidth = Math.max(2, c * 0.12);
			ctx.strokeRect(dx, y + c * 0.06, DRAWER_W * c, c * 0.88);
			// Slot guide in the column.
			ctx.globalAlpha = 0.12 + 0.1 * pulse;
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(dx, L.colY, DRAWER_W * c, c);
			ctx.restore();
		}
	}

	drawFlying(dt) {
		const { ctx, L, game } = this;
		const c = L.c;
		const active = game.active;
		const ids = new Set();
		for (const p of game.flying) {
			ids.add(p.id);
			let v = this.vis.get(p.id);
			if (!v) {
				v = { x: p.x, y: p.y };
				this.vis.set(p.id, v);
			}
			const k = Math.min(1, dt * 22);
			v.x += (p.x - v.x) * k;
			v.y += (p.y - v.y) * k;
			let ox = v.x;
			let oy = v.y;
			let alpha = p === active ? 1 : 0.92;
			if (p.state === 'reject') {
				ox += Math.sin(p.t * 70) * 0.15;
				if (p.cup !== null && p.cup !== undefined) ox += p.cup < 3 ? -0.6 : 0.6;
			}
			if (p.state === 'drop') {
				oy += p.dropY || 0;
				alpha = Math.max(0, 1 - p.t / 0.4);
			}
			const col = TYPE_COLOURS[p.type];
			const style = { bg: col, fg: shade(col, -0.3) };
			if (p.state === 'reject' || p.state === 'drop') style.bg = shade(col, -0.15);
			ctx.save();
			ctx.globalAlpha = alpha;
			if (p === active) {
				ctx.shadowColor = col;
				ctx.shadowBlur = c * 0.8;
			}
			let i = 0;
			for (const [cx, cy] of p.cells) {
				const [px, py] = this.cellXY(ox + cx, oy + cy);
				this.drawCell(px, py, c, style, p.kind, {
					outline: p === active ? '#ffffff' : p.state === 'reject' ? '#ff6b5e' : 'rgba(255,255,255,0.45)',
					cutlery: p.type === 'I' ? i : undefined,
				});
				i++;
			}
			ctx.restore();
			// Pause timer under the piece while it waits at a shelf.
			if (p === active && p.state === 'dwell') {
				const left = Math.max(0, 1 - p.t / game.t.floorDwell);
				const { w, h } = size(p.cells);
				const [bx, by] = this.cellXY(ox, oy + h);
				ctx.fillStyle = 'rgba(255,255,255,0.15)';
				ctx.fillRect(bx, by + c * 0.12, w * c, c * 0.14);
				ctx.fillStyle = '#fff1b8';
				ctx.fillRect(bx, by + c * 0.12, w * c * left, c * 0.14);
			}
			// Patience: a ring that empties while the piece is among the
			// cupboards. When it runs out the piece is sent back.
			if (p === active && p.zoneT > 0 && (p.state === 'rise' || p.state === 'dwell' || p.state === 'ceiling')) {
				const used = game.patienceUsed(p);
				const { w } = size(p.cells);
				let [rx, ry] = this.cellXY(ox + w, oy);
				const rad = c * 0.42;
				rx += rad + c * 0.14;
				if (rx + rad > L.rightX - 2) rx = L.colX + ox * c - rad - c * 0.14;
				ry = Math.max(ry + rad * 0.3, L.colY + rad + 2);
				const warn = used > 0.7;
				const wob = warn ? Math.sin(this.time * 30) * c * 0.05 : 0;
				ctx.fillStyle = 'rgba(0,0,0,0.6)';
				ctx.beginPath();
				ctx.arc(rx + wob, ry, rad + c * 0.08, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = warn ? '#ff7a66' : '#fff3c4';
				ctx.lineWidth = Math.max(2, c * 0.14);
				ctx.lineCap = 'round';
				ctx.beginPath();
				ctx.arc(rx + wob, ry, rad * 0.75, -Math.PI / 2 + Math.PI * 2 * used, Math.PI * 1.5);
				ctx.stroke();
			}
		}
		for (const id of this.vis.keys()) if (!ids.has(id)) this.vis.delete(id);
	}

	drawKickPlate() {
		const { ctx, L, game } = this;
		const c = L.c;
		const y = L.bottomY;
		const h = c * 1.3;
		const g = ctx.createLinearGradient(0, y, 0, y + h);
		g.addColorStop(0, '#c9ced4');
		g.addColorStop(1, '#8e959c');
		ctx.fillStyle = g;
		ctx.fillRect(L.ox, y, L.width, h);
		ctx.fillStyle = 'rgba(0,0,0,0.25)';
		ctx.fillRect(L.ox, y, L.width, c * 0.08);
		// Control panel: a progress light for the next rack row.
		const px = L.colX + c * 0.5;
		const pw = L.colW - c * 1;
		ctx.fillStyle = '#2a2f35';
		rr(ctx, px, y + c * 0.35, pw, c * 0.6, c * 0.3);
		ctx.fill();
		const prog = Math.min(1, game.rowT / game.t.rowInterval);
		const soon = prog > 0.8;
		ctx.fillStyle = soon ? '#ffb347' : '#5fd38d';
		rr(ctx, px + c * 0.12, y + c * 0.47, Math.max(c * 0.36, (pw - c * 0.24) * prog), c * 0.36, c * 0.18);
		ctx.fill();
		// Knobs.
		for (const kx of [L.ox + c * 1.2, L.ox + c * 2.6, L.rightX + c * 1.4, L.rightX + c * 2.8]) {
			ctx.fillStyle = '#5b6168';
			ctx.beginPath();
			ctx.arc(kx, y + c * 0.65, c * 0.32, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#d9dde2';
			ctx.fillRect(kx - c * 0.04, y + c * 0.38, c * 0.08, c * 0.22);
		}
	}

	drawEffects(dt) {
		const { ctx, L } = this;
		if (this.flashRow > 0) this.flashRow -= dt;
		for (const p of this.particles) {
			p.life -= dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			if (!p.bubble) p.vy += L.c * 20 * dt;
			ctx.globalAlpha = Math.max(0, p.life);
			if (p.bubble) {
				ctx.strokeStyle = p.colour;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
				ctx.stroke();
			} else {
				ctx.fillStyle = p.colour;
				ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
			}
		}
		ctx.globalAlpha = 1;
		this.particles = this.particles.filter((p) => p.life > 0);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (const p of this.popups) {
			p.life -= dt;
			p.y -= L.c * 1.2 * dt;
			const a = Math.max(0, Math.min(1, p.life / p.max * 2));
			ctx.globalAlpha = a;
			ctx.font = `800 ${Math.round(L.c * 0.7)}px system-ui, sans-serif`;
			ctx.lineWidth = Math.max(2, L.c * 0.18);
			ctx.strokeStyle = 'rgba(0,0,0,0.75)';
			const half = ctx.measureText(p.text).width / 2 + L.c * 0.3;
			const x = Math.max(L.ox + half, Math.min(L.ox + L.width - half, p.x));
			ctx.strokeText(p.text, x, p.y);
			ctx.fillStyle = p.colour;
			ctx.fillText(p.text, x, p.y);
		}
		ctx.globalAlpha = 1;
		this.popups = this.popups.filter((p) => p.life > 0);
	}

	// Where the HTML pause and sound buttons sit on the score bar.
	hudButtons() {
		const L = this.L;
		const c = L.c;
		const s = Math.round(c * 1.6);
		const gap = Math.round(c * 0.2);
		const w = 2 * s + gap;
		return { x: L.ox + L.width - w - Math.round(c * 0.2), y: L.hudY + Math.round((c * 2.2 - s) / 2), w, h: s, gap };
	}

	drawHud() {
		const { ctx, L, game } = this;
		const c = L.c;
		const y = L.hudY;
		const h = c * 2.2;
		ctx.fillStyle = '#3b2c22';
		ctx.fillRect(L.ox, y, L.width, h);
		ctx.fillStyle = 'rgba(255,255,255,0.06)';
		ctx.fillRect(L.ox, y, L.width, h * 0.45);
		const label = (txt, x, align = 'left') => {
			ctx.fillStyle = '#d7b98f';
			ctx.font = `700 ${Math.round(c * 0.5)}px system-ui, sans-serif`;
			ctx.textAlign = align;
			ctx.textBaseline = 'alphabetic';
			ctx.fillText(txt, x, y + c * 0.78);
		};
		const value = (txt, x, align = 'left', size = 0.95) => {
			ctx.fillStyle = '#fff7ea';
			ctx.font = `800 ${Math.round(c * size)}px system-ui, sans-serif`;
			ctx.textAlign = align;
			ctx.fillText(txt, x, y + c * 1.85);
		};
		label('SCORE', L.ox + c * 0.4);
		value(fmt(game.score), L.ox + c * 0.4);
		if (game.streak >= 2) {
			ctx.fillStyle = '#ffd36e';
			ctx.font = `800 ${Math.round(c * 0.5)}px system-ui, sans-serif`;
			ctx.textAlign = 'left';
			ctx.fillText(`RUN ×${game.streak}`, L.ox + c * 3.3, y + c * 0.78);
		}
		label('LEVEL', L.ox + c * 6.6);
		value(String(game.level), L.ox + c * 6.6);
		// Level progress pips (two rows of five).
		const into = game.stored % PER_LEVEL;
		for (let i = 0; i < PER_LEVEL; i++) {
			ctx.fillStyle = i < into ? '#f4c542' : 'rgba(255,255,255,0.15)';
			ctx.fillRect(L.ox + c * (8.15 + (i % 5) * 0.34), y + c * (1.1 + Math.floor(i / 5) * 0.4), c * 0.26, c * 0.3);
		}
		label('BEST', L.ox + c * 10.0);
		value(fmt(Math.max(game.best, game.score)), L.ox + c * 10.0, 'left', 0.75);
	}

	drawBanner() {
		const { ctx, L } = this;
		const c = L.c;
		const a = Math.min(1, this.banner.t * 2);
		ctx.globalAlpha = a;
		ctx.fillStyle = 'rgba(20,16,12,0.75)';
		const y = L.colY + (ZONE + 3) * c;
		ctx.fillRect(L.colX, y, L.colW, c * 2);
		ctx.fillStyle = '#f4c542';
		ctx.font = `900 ${Math.round(c * 1.1)}px system-ui, sans-serif`;
		const tw = ctx.measureText(this.banner.text).width;
		if (tw > L.colW - c * 0.6) ctx.font = `900 ${Math.floor(c * 1.1 * (L.colW - c * 0.6) / tw)}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if (this.banner.sub) {
			ctx.fillText(this.banner.text, L.colX + L.colW / 2, y + c * 0.7);
			ctx.fillStyle = '#fff7ea';
			ctx.font = `800 ${Math.round(c * 0.75)}px system-ui, sans-serif`;
			ctx.fillText(this.banner.sub, L.colX + L.colW / 2, y + c * 1.55);
		} else {
			ctx.fillText(this.banner.text, L.colX + L.colW / 2, y + c);
		}
		ctx.globalAlpha = 1;
	}

	// The board dims under the "Tea break" card while paused.
	drawPaused() {
		const { ctx, L } = this;
		ctx.fillStyle = 'rgba(10,8,6,0.45)';
		ctx.fillRect(L.ox, L.topY, L.width, L.height - (L.topY - L.oy));
	}
}
