// SirTet game state and rules. No DOM in here: the game is advanced with
// update(dt) and poked with the action methods, and it reports what
// happened through `events` for the renderer and sound to pick up.

import { identify, normalise, rotateCW, rotateCCW, size } from './pieces.js';
import * as Stack from './stack.js';
import * as Cup from './cupboard.js';

export const W = 10; // column width
export const H = 22; // column height
export const ZONE = 6; // rows 0..5 are the cupboard zone
export const FLOORS = [0, 2, 4]; // top row of each cupboard
export const WAIT_ROW = ZONE; // queued pieces wait below the zone
export const DRAWER_X = 3; // cutlery drawer spans columns 3..6 at the top
export const DRAWER_W = 4;
export const START_ROWS = 3;
export const PER_LEVEL = 10;

// Difficulty for a given level.
export function tuning(level) {
	const l = level - 1;
	return {
		rowInterval: Math.max(1.5, 4.0 - 0.2 * l),
		riseStep: Math.max(0.08, 0.17 - 0.009 * l),
		popStep: 0.05,
		hurryStep: 0.035,
		floorDwell: Math.max(0.45, 0.9 - 0.04 * l),
		// Seconds a piece may spend among the cupboards before it is sent back.
		patience: Math.max(3.6, 6.5 - 0.3 * l),
		launchGap: Math.max(0.6, 1.1 - 0.05 * l),
		kinds: level >= 10 ? 5 : level >= 5 ? 4 : 3,
		density: Math.min(0.7, 0.5 + 0.02 * Math.max(0, l - 11)),
		maxFlying: 3,
	};
}

const DOOR_CLOSING = 0.25;
const DOOR_CLOSED = 0.8;
const DOOR_OPENING = 0.3;
const REJECT_SHAKE = 0.35;
const DROP_TIME = 0.4;

export class Game {
	constructor(seed = Date.now()) {
		this.seed = seed;
		this.best = 0;
		this.mode = 'title';
		this.reset(seed);
		this.mode = 'title';
	}

	reset(seed = this.seed + 1) {
		this.seed = seed;
		this.rng = Stack.makeRng(seed);
		this.grid = Stack.makeGrid(W, H);
		this.cupboards = [];
		for (const side of ['L', 'R']) for (let f = 0; f < 3; f++) this.cupboards.push(Cup.createCupboard(side, f));
		this.flying = [];
		this.nextId = 1;
		this.score = 0;
		this.streak = 0;
		this.bestStreak = 0;
		this.emptied = 0;
		this.level = 1;
		this.stored = 0;
		this.rejected = 0;
		this.drawerCount = 0;
		this.time = 0;
		this.rowT = 0;
		this.launchT = 10;
		this.settleT = 0.6;
		this.candidates = [];
		this.events = [];
		this.drawerFlash = 0;
		this.overReason = null;
		this.t = tuning(1);
		// Three rows of random dishes to start, with a piece or two ready to
		// go so the first one lifts off straight away.
		for (let tries = 0; tries < 60; tries++) {
			this.grid = Stack.makeGrid(W, H);
			const rows = [];
			for (let i = 0; i < START_ROWS; i++) rows.push(Stack.randomRow(W, this.rng, 0.9, this.t.kinds));
			Stack.pushRows(this.grid, rows);
			Stack.applyGravity(this.grid);
			const n = Stack.findCandidates(this.grid).length;
			if (n >= 1 && n <= 2) break;
		}
		this.rowT = this.t.rowInterval * 0.4;
		this.mode = 'playing';
	}

	emit(e) {
		this.events.push(e);
	}

	drainEvents() {
		const e = this.events;
		this.events = [];
		return e;
	}

	// The playing piece is the uppermost one still in flight (the oldest on
	// a tie). Everything below it queues under the cupboard zone.
	get active() {
		let best = null;
		for (const p of this.flying) {
			if (p.state !== 'rise' && p.state !== 'dwell' && p.state !== 'ceiling') continue;
			if (!best || p.y < best.y) best = p;
		}
		return best;
	}

	update(dt) {
		if (this.mode !== 'playing') return;
		dt = Math.min(dt, 0.1);
		this.time += dt;
		this.t = tuning(this.level);
		this.animateCells(dt);
		this.updateDoors(dt);
		if (this.drawerFlash > 0) this.drawerFlash -= dt;

		this.rowT += dt;
		if (this.rowT >= this.t.rowInterval) {
			this.rowT = 0;
			this.addRows([Stack.randomRow(W, this.rng, this.t.density, this.t.kinds)]);
			this.emit({ t: 'row' });
			if (this.mode !== 'playing') return;
		}

		if (this.settleT > 0) {
			this.settleT -= dt;
			if (this.settleT <= 0) this.candidates = Stack.findCandidates(this.grid);
		}

		this.launchT += dt;
		this.tryLaunch();

		const active = this.active;
		for (const p of [...this.flying]) this.updatePiece(p, dt, p === active);
	}

	animateCells(dt) {
		const speed = 14 * dt;
		for (const row of this.grid)
			for (const c of row) {
				if (!c) continue;
				if (c.fy) c.fy = Math.abs(c.fy) <= speed ? 0 : c.fy - Math.sign(c.fy) * speed;
				if (c.fx) c.fx = Math.abs(c.fx) <= speed ? 0 : c.fx - Math.sign(c.fx) * speed;
			}
	}

	updateDoors(dt) {
		for (const cup of this.cupboards) {
			if (cup.flash > 0) cup.flash -= dt;
			if (cup.door === 'open') continue;
			cup.doorT += dt;
			if (cup.door === 'closing' && cup.doorT >= DOOR_CLOSING) {
				cup.door = 'closed';
				cup.doorT = 0;
				Cup.empty(cup);
			} else if (cup.door === 'closed' && cup.doorT >= DOOR_CLOSED) {
				cup.door = 'opening';
				cup.doorT = 0;
			} else if (cup.door === 'opening' && cup.doorT >= DOOR_OPENING) {
				cup.door = 'open';
				cup.doorT = 0;
			}
		}
	}

	// Insert rows at the bottom, settle, and check for a full screen.
	addRows(rows) {
		for (const row of this.grid) for (const c of row) if (c) c.fy = (c.fy || 0) + rows.length;
		const overflow = Stack.pushRows(this.grid, rows);
		for (const row of rows) for (const c of row) if (c) c.fy = (c.fy || 0) + rows.length;
		this.gravity();
		if (overflow || Stack.stackTop(this.grid) < ZONE) this.gameOver('full');
	}

	// Dishes drop into holes, then any dish teetering on a column more
	// than two higher than its neighbour slides off onto the lower one, so
	// the rack never grows thin spires.
	gravity() {
		const moves = Stack.applyGravity(this.grid);
		for (const m of moves) {
			const c = this.grid[m.to][m.x];
			c.fy = (c.fy || 0) - (m.to - m.from);
		}
		for (const m of Stack.topple(this.grid)) {
			const c = m.cell;
			c.fx = (c.fx || 0) + (m.fromX - m.toX);
			c.fy = (c.fy || 0) + (m.fromY - m.toY);
		}
		this.settleT = 0.3;
		this.candidates = [];
	}

	// A completely empty rack is worth a big bonus.
	checkEmpty() {
		if (Stack.countCells(this.grid) > 0) return;
		const bonus = 1000 * this.level;
		this.score += bonus;
		this.emptied++;
		this.rowT = Math.max(this.rowT, this.t.rowInterval - 0.8);
		this.emit({ t: 'empty', bonus });
	}

	tryLaunch() {
		if (this.settleT > 0 || !this.candidates.length) return;
		if (this.launchT < this.t.launchGap) return;
		const inFlight = this.flying.filter((p) => p.state !== 'drop' && p.state !== 'reject');
		if (inFlight.length >= this.t.maxFlying) return;
		const cand = this.candidates[0];
		const type = identify(cand.cells);
		if (!type) {
			this.candidates.shift();
			return;
		}
		let minX = Infinity;
		let minY = Infinity;
		for (const [x, y] of cand.cells) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
		}
		const piece = {
			id: this.nextId++,
			type,
			kind: cand.kind,
			cells: normalise(cand.cells),
			x: minX,
			y: minY,
			state: 'rise',
			t: 0,
			hurry: false,
			vy: 0,
			born: this.time,
		};
		if (this.collides(piece, piece.cells, piece.x, piece.y)) return;
		Stack.removeCells(this.grid, cand.cells);
		const washed = Stack.washAround(this.grid, cand.cells, this.rng, this.t.kinds);
		if (washed.length) {
			this.score += 5 * washed.length;
			this.emit({ t: 'wash', cells: washed });
		}
		this.flying.push(piece);
		this.launchT = 0;
		this.gravity();
		this.emit({ t: 'launch', type, x: piece.x, y: piece.y });
		this.checkEmpty();
	}

	// Does `cells` at (x, y) overlap another flying piece?
	collides(self, cells, x, y) {
		for (const o of this.flying) {
			if (o === self || o.state === 'drop' || o.state === 'reject') continue;
			for (const [ax, ay] of cells)
				for (const [bx, by] of o.cells) if (ax + x === bx + o.x && ay + y === by + o.y) return true;
		}
		return false;
	}

	overlapsStack(p) {
		for (const [cx, cy] of p.cells) {
			const y = cy + p.y;
			if (y >= 0 && y < H && this.grid[y][cx + p.x]) return true;
		}
		return false;
	}

	updatePiece(p, dt, isActive) {
		const t = this.t;
		p.t += dt;
		if (isActive && p.y < ZONE && (p.state === 'rise' || p.state === 'dwell' || p.state === 'ceiling')) {
			p.zoneT = (p.zoneT || 0) + dt;
			if (p.zoneT >= t.patience) {
				this.reject(p, 'patience');
				return;
			}
		}
		if (p.state === 'rise') {
			const popping = this.overlapsStack(p);
			const step = popping ? t.popStep : p.hurry && isActive ? t.hurryStep : t.riseStep;
			if (p.t < step) return;
			p.t = 0;
			const ny = p.y - 1;
			if (ny < 0) return;
			if (!isActive && ny < WAIT_ROW) return;
			if (this.collides(p, p.cells, p.x, ny)) return;
			p.y = ny;
			if (isActive && FLOORS.includes(p.y)) {
				p.hurry = false;
				p.state = p.y === 0 ? 'ceiling' : 'dwell';
				p.t = 0;
				this.emit({ t: 'floor', y: p.y });
				if (p.y === 0) this.checkDrawer(p);
			}
		} else if (p.state === 'dwell') {
			if (p.t >= t.floorDwell) {
				p.state = 'rise';
				p.t = 0;
			}
		} else if (p.state === 'reject') {
			if (p.t >= REJECT_SHAKE) {
				p.state = 'drop';
				p.t = 0;
			}
		} else if (p.state === 'drop') {
			p.vy += 60 * dt;
			p.dropY = (p.dropY || 0) + p.vy * dt;
			if (p.t >= DROP_TIME) this.landJunk(p);
		}
	}

	checkDrawer(p) {
		if (p.type !== 'I' || p.y !== 0) return false;
		const { w, h } = size(p.cells);
		if (h !== 1 || w !== DRAWER_W || p.x !== DRAWER_X) return false;
		this.flying.splice(this.flying.indexOf(p), 1);
		// Cutlery away: the bottom row of the rack is cleared.
		const bottom = this.grid[H - 1];
		const cleared = bottom.filter((c) => c).length;
		this.grid.pop();
		this.grid.unshift(Array(W).fill(null));
		for (const row of this.grid) for (const c of row) if (c) c.fy = (c.fy || 0) - 1;
		this.gravity();
		const points = 100 * this.level + 10 * cleared;
		this.score += points;
		this.drawerCount++;
		this.drawerFlash = 0.8;
		this.countStored();
		this.emit({ t: 'drawer', points, cleared });
		this.checkEmpty();
		return true;
	}

	// How much of the active piece's patience is used up (0..1).
	patienceUsed(p = this.active) {
		if (!p) return 0;
		return Math.min(1, (p.zoneT || 0) / this.t.patience);
	}

	reject(p, reason, cupIdx = null) {
		p.state = 'reject';
		p.t = 0;
		p.reason = reason;
		p.cup = cupIdx;
		p.hurry = false;
		this.rejected++;
		this.streak = 0;
		if (cupIdx !== null) this.cupboards[cupIdx].flash = 0.5;
		this.emit({ t: 'reject', reason, cup: cupIdx, x: p.x, y: p.y, type: p.type });
	}

	// A rejected piece lands as chipped crockery at the bottom, bringing
	// a little extra clutter with it, and pushes the rows up.
	landJunk(p) {
		this.flying.splice(this.flying.indexOf(p), 1);
		const { h } = size(p.cells);
		const rows = [];
		for (let r = 0; r < h; r++) {
			const row = Array(W).fill(null);
			for (let x = 0; x < W; x++) if (this.rng() < 0.3) row[x] = { k: Math.floor(this.rng() * this.t.kinds) };
			rows.push(row);
		}
		for (const [cx, cy] of p.cells) rows[cy][cx + p.x] = { k: Stack.JUNK };
		this.emit({ t: 'junk', type: p.type });
		this.addRows(rows);
	}

	countStored() {
		this.stored++;
		const lvl = 1 + Math.floor(this.stored / PER_LEVEL);
		if (lvl > this.level) {
			this.level = lvl;
			this.emit({ t: 'level', level: lvl });
		}
	}

	// ---- player actions -------------------------------------------------

	move(dir) {
		const p = this.active;
		if (!p || this.mode !== 'playing') return 'none';
		const { w, h } = size(p.cells);
		const nx = p.x + dir;
		if (nx >= 0 && nx + w <= W) {
			if (this.collides(p, p.cells, nx, p.y)) return 'bump';
			p.x = nx;
			if (p.state === 'ceiling') this.checkDrawer(p);
			return 'moved';
		}
		// Pushing against a wall: is there a cupboard opening here?
		if (!FLOORS.includes(p.y) || h !== Cup.CUPBOARD_ROWS) {
			this.emit({ t: 'bump' });
			return 'bump';
		}
		const idx = (dir < 0 ? 0 : 3) + FLOORS.indexOf(p.y);
		const verdict = Cup.judge(this.cupboards, idx, p.type, p.cells);
		if (verdict === 'blocked') {
			this.emit({ t: 'bump' });
			return 'bump';
		}
		if (verdict === 'store') {
			const cup = this.cupboards[idx];
			const n = Cup.store(cup, p.type, p.cells);
			cup.items[cup.items.length - 1].slide = 1;
			this.flying.splice(this.flying.indexOf(p), 1);
			// Tidy runs pay: every piece put away in a row without a
			// mistake is worth more, and leaving the shelf level is a bonus.
			this.streak++;
			this.bestStreak = Math.max(this.bestStreak, this.streak);
			const neat = n > 1 && cup.front[0] === cup.front[1];
			const points = (20 + 10 * Math.min(this.streak - 1, 10) + (neat ? 30 : 0)) * this.level;
			this.score += points;
			this.countStored();
			this.emit({ t: 'store', cup: idx, n, points, type: p.type, first: n === 1, neat, streak: this.streak });
			return 'store';
		}
		this.reject(p, verdict, idx);
		return verdict;
	}

	rotate(dir = 1) {
		const p = this.active;
		if (!p || this.mode !== 'playing') return false;
		const cells = dir > 0 ? rotateCW(p.cells) : rotateCCW(p.cells);
		const a = size(p.cells);
		const b = size(cells);
		const baseX = p.x + Math.floor((a.w - b.w) / 2);
		if (p.y + b.h > H) return false;
		for (const k of [0, -1, 1, -2, 2]) {
			const nx = baseX + k;
			if (nx < 0 || nx + b.w > W) continue;
			if (this.collides(p, cells, nx, p.y)) continue;
			p.cells = cells;
			p.x = nx;
			if (p.state === 'ceiling') this.checkDrawer(p);
			this.emit({ t: 'rotate' });
			return true;
		}
		return false;
	}

	// "Next floor, please": skip the current pause or hurry to the next stop.
	hurry() {
		const p = this.active;
		if (!p || this.mode !== 'playing') return;
		if (p.state === 'dwell') {
			p.state = 'rise';
			p.t = 0;
		}
		if (p.state === 'rise') p.hurry = true;
	}

	// "Back down a floor": for a shelf you went past. The piece drops to
	// the next cupboard level below and pauses there again. Its patience
	// keeps running, so dithering still costs.
	sink() {
		const p = this.active;
		if (!p || this.mode !== 'playing') return false;
		const target = FLOORS.find((f) => f > p.y);
		if (target === undefined) return false;
		const probe = { ...p, y: target };
		if (this.collides(p, p.cells, p.x, target) || this.overlapsStack(probe)) return false;
		p.y = target;
		p.state = 'dwell';
		p.t = 0;
		p.hurry = false;
		this.emit({ t: 'sink', y: target });
		return true;
	}

	closeDoor(idx) {
		const cup = this.cupboards[idx];
		if (!cup || this.mode !== 'playing') return 0;
		if (cup.door !== 'open' || cup.items.length === 0) return 0;
		const n = cup.items.length;
		const bonus = 5 * n * n * this.level;
		this.score += bonus;
		cup.door = 'closing';
		cup.doorT = 0;
		this.emit({ t: 'door', cup: idx, n, bonus });
		return bonus;
	}

	gameOver(reason) {
		if (this.mode === 'over') return;
		this.mode = 'over';
		this.overReason = reason;
		if (this.score > this.best) this.best = this.score;
		this.emit({ t: 'over', score: this.score });
	}

	pause(on = this.mode === 'playing') {
		if (on && this.mode === 'playing') this.mode = 'paused';
		else if (!on && this.mode === 'paused') this.mode = 'playing';
	}

	// Which cupboard is home for this type right now (index or -1).
	homeOf(type) {
		return this.cupboards.findIndex((c) => c.type === type && c.door === 'open');
	}

	danger() {
		const top = Stack.stackTop(this.grid);
		return Math.max(0, Math.min(1, (ZONE + 5 - top) / 5));
	}
}
