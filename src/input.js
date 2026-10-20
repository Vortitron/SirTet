// Keyboard and touch/mouse controls.
//
// Touch: tap the flying piece to turn it, tap to its left or right to move
// it a step (hold to keep moving), swipe up to send it on to the next
// shelf, swipe down to drop back a shelf, and swipe across a cupboard to
// shut its door.
//
// A press on a cupboard could be a steering tap or the start of a door
// swipe, so it waits a moment (TAP_WAIT) before it steers. So does any
// press whose step would push the piece into a cupboard, in case it is
// the start of a swipe to the next shelf. A normal tap is
// over before then and steers on release; a finger that stays down starts
// steering and repeats like anywhere else. Only a sideways swipe shuts a
// door, so holding to slide never shuts one by accident.
import { size } from './pieces.js';
import { cupboardAt } from './layout.js';
import { W } from './game.js';

const REPEAT_DELAY = 0.24;
const REPEAT_EVERY = 0.075;
const SWIPE = 28; // px of vertical drag for next/previous shelf
const DOOR_SWIPE = 24; // px of sideways drag across a cupboard
const TAP_WAIT = 0.12; // s a press on a cupboard, or a wall push, waits before steering

export class Input {
	constructor(canvas, app) {
		this.canvas = canvas;
		this.app = app;
		this.keys = new Map(); // code -> { t, dir }
		this.ptr = null;
		window.addEventListener('keydown', (e) => this.keydown(e));
		window.addEventListener('keyup', (e) => this.keys.delete(e.code));
		window.addEventListener('blur', () => this.keys.clear());
		canvas.addEventListener('pointerdown', (e) => this.down(e));
		canvas.addEventListener('pointermove', (e) => this.moveP(e));
		canvas.addEventListener('pointerup', (e) => this.up(e));
		canvas.addEventListener('pointercancel', () => {
			this.ptr = null;
			this.app.renderer.hold = null;
		});
		canvas.addEventListener('contextmenu', (e) => e.preventDefault());
	}

	get game() {
		return this.app.game;
	}

	// Input only drives a real game, never the demo behind the title.
	get live() {
		return !this.app.demo && this.game.mode === 'playing';
	}

	keydown(e) {
		const app = this.app;
		app.sound.unlock();
		const g = this.game;
		const code = e.code;
		// Let buttons handle their own keys.
		if ((code === 'Enter' || code === 'Space') && e.target && e.target.tagName === 'BUTTON') return;
		if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) e.preventDefault();
		if (code === 'Enter' && (app.demo || g.mode === 'over')) {
			if (app.canRestart()) app.start();
			return;
		}
		if (code === 'Enter' && g.mode === 'paused') {
			app.togglePause();
			return;
		}
		if (code === 'KeyP' || code === 'Escape') {
			if (!app.demo) app.togglePause();
			return;
		}
		if (code === 'KeyM') {
			app.toggleMute();
			return;
		}
		if (!this.live || e.repeat) return;
		switch (code) {
			case 'ArrowLeft':
			case 'KeyA':
				g.move(-1);
				this.keys.set(code, { t: 0, dir: -1 });
				break;
			case 'ArrowRight':
			case 'KeyD':
				g.move(1);
				this.keys.set(code, { t: 0, dir: 1 });
				break;
			case 'ArrowUp':
			case 'KeyX':
			case 'KeyW':
				g.rotate(1);
				break;
			case 'KeyZ':
				g.rotate(-1);
				break;
			case 'ArrowDown':
			case 'KeyS':
				g.sink();
				break;
			case 'Space':
				g.hurry();
				break;
			default: {
				const m = /^(?:Digit|Numpad)([1-6])$/.exec(code);
				if (m) g.closeDoor(Number(m[1]) - 1);
			}
		}
	}

	pos(e) {
		const r = this.canvas.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}

	// What a tap at (x, y) would do to the active piece.
	zoneFor(x, y) {
		const g = this.game;
		const p = g.active;
		const L = this.app.renderer.L;
		if (!p) return null;
		const v = this.app.renderer.vis.get(p.id) || p;
		const { w, h } = size(p.cells);
		const px = L.colX + v.x * L.c;
		const py = L.colY + v.y * L.c;
		const m = L.c * 0.7;
		if (x >= px - m && x <= px + w * L.c + m && y >= py - m && y <= py + h * L.c + m) return 'rotate';
		return x < px + (w * L.c) / 2 ? 'left' : 'right';
	}

	act(zone) {
		const g = this.game;
		if (zone === 'rotate') g.rotate(1);
		else if (zone === 'left') g.move(-1);
		else if (zone === 'right') g.move(1);
	}

	down(e) {
		e.preventDefault();
		const app = this.app;
		app.sound.unlock();
		if (!this.live) return;
		const [x, y] = this.pos(e);
		try {
			this.canvas.setPointerCapture(e.pointerId);
		} catch {
			// not essential
		}
		const cup = cupboardAt(app.renderer.L, x, y);
		this.ptr = { id: e.pointerId, x0: x, y0: y, x, y, t: 0, cup, zone: this.zoneFor(x, y), acted: false, done: false, nextRepeat: REPEAT_DELAY };
		// Away from the cupboards a tap acts at once, so it feels snappy,
		// unless that step would push the piece into a cupboard: a push can
		// put the piece away or send it back, which a swipe cannot undo, so
		// it waits until the press is known to be a tap.
		if (cup === -1 && !this.pushesWall(this.ptr.zone)) this.steer(this.ptr);
	}

	// Would a step towards this side push the active piece against a wall?
	pushesWall(zone) {
		const p = this.game.active;
		if (!p || (zone !== 'left' && zone !== 'right')) return false;
		return zone === 'left' ? p.x <= 0 : p.x + size(p.cells).w >= W;
	}

	steer(p) {
		if (p.acted) return;
		p.acted = true;
		p.zone = this.zoneFor(p.x0, p.y0);
		if (!p.zone) return;
		// Remember where the piece was, so that if this press turns out to
		// be a swipe the step it took can be taken back.
		const piece = this.game.active;
		const before = piece && { piece, x: piece.x, cells: piece.cells, state: piece.state };
		this.act(p.zone);
		if (before && this.game.flying.includes(piece) && piece.state === before.state) p.undo = before;
	}

	// Swipes act on the piece, not the step the opening tap gave it.
	takeBack(p) {
		const u = p.undo;
		p.undo = null;
		if (!u || p.t > 0.3 || p.repeating || this.game.active !== u.piece) return;
		u.piece.x = u.x;
		u.piece.cells = u.cells;
	}

	moveP(e) {
		const p = this.ptr;
		if (!p || p.id !== e.pointerId || p.done) return;
		[p.x, p.y] = this.pos(e);
		const dx = p.x - p.x0;
		const dy = p.y - p.y0;
		if (Math.abs(dy) > SWIPE && Math.abs(dy) > Math.abs(dx)) {
			p.done = true;
			this.takeBack(p);
			if (dy < 0) this.game.hurry();
			else this.game.sink();
		} else if (p.cup !== -1 && !p.acted && Math.abs(dx) > DOOR_SWIPE && Math.abs(dx) > Math.abs(dy)) {
			p.done = true;
			this.game.closeDoor(p.cup);
		}
	}

	up(e) {
		const p = this.ptr;
		if (!p || p.id !== e.pointerId) return;
		this.ptr = null;
		// A quick tap on a cupboard steers the piece like any other tap.
		if (!p.done && this.live) this.steer(p);
	}

	update(dt) {
		if (!this.live) {
			this.ptr = null;
			return;
		}
		const g = this.game;
		for (const k of this.keys.values()) {
			if (!k.dir) continue;
			k.t += dt;
			if (k.t >= REPEAT_DELAY) {
				g.move(k.dir);
				k.t = REPEAT_DELAY - REPEAT_EVERY;
			}
		}
		const p = this.ptr;
		if (!p || p.done) return;
		p.t += dt;
		if (!p.acted) {
			// Still waiting to see if this is a tap or a swipe. A finger
			// already on the move is a swipe in progress, so keep waiting.
			if (p.t < TAP_WAIT || Math.hypot(p.x - p.x0, p.y - p.y0) > 10) return;
			this.steer(p);
		}
		if ((p.zone === 'left' || p.zone === 'right') && p.t >= p.nextRepeat) {
			p.nextRepeat += REPEAT_EVERY;
			p.repeating = true;
			g.move(p.zone === 'left' ? -1 : 1);
		}
	}
}
