// A simple autopilot used for balancing and by the playtest. It picks a
// cupboard for the active piece, turns it the right way round and steers.
// `skill` (0..1) is the chance it makes a sensible decision on each think.
import { size, rotateCW, key } from './pieces.js';
import * as Cup from './cupboard.js';
import { FLOORS, DRAWER_X, W } from './game.js';

function orientations(cells) {
	const out = [];
	const seen = new Set();
	let s = cells;
	for (let i = 0; i < 4; i++) {
		if (!seen.has(key(s))) {
			seen.add(key(s));
			out.push({ cells: s, turns: i });
		}
		s = rotateCW(s);
	}
	return out;
}

export function plan(game) {
	const p = game.active;
	if (!p) return null;
	if (p.type === 'I') return { kind: 'drawer', turns: orientations(p.cells).find((o) => size(o.cells).h === 1).turns };
	let best = null;
	game.cupboards.forEach((cup, idx) => {
		if (cup.door !== 'open') return;
		for (const o of orientations(p.cells)) {
			if (Cup.judge(game.cupboards, idx, p.type, o.cells) !== 'store') continue;
			const floorY = FLOORS[cup.floor];
			// A shelf already passed can be reached again by sinking, but
			// that costs patience, so prefer shelves still ahead.
			const passed = floorY < p.y ? 0 : floorY > p.y ? 3 : 0;
			const score = (cup.type === p.type ? 0 : 5) + (floorY === 0 ? 0 : 1) + passed;
			if (!best || score < best.score) best = { kind: 'cup', idx, turns: o.turns, cells: o.cells, score };
		}
	});
	if (!best) {
		// Nothing fits: close the door of this type's home so it can start again.
		const home = game.homeOf(p.type);
		if (home >= 0) return { kind: 'close', idx: home };
	}
	return best;
}

// What the autopilot would press next: 'left', 'right', 'rotate',
// 'hurry', 'close:<idx>' or null. Used by step() and by the playtest,
// which turns the advice into real key presses or taps.
export function advise(game) {
	const p = game.active;
	if (!p) return null;
	const pl = plan(game);
	if (!pl) return null;
	if (pl.kind === 'close') return 'close:' + pl.idx;
	if (pl.turns > 0) return 'rotate';
	const { w } = size(p.cells);
	if (pl.kind === 'drawer') {
		if (p.x < DRAWER_X) return 'right';
		if (p.x > DRAWER_X) return 'left';
		return p.state === 'dwell' ? 'hurry' : null;
	}
	const cup = game.cupboards[pl.idx];
	const left = cup.side === 'L';
	if (FLOORS[cup.floor] > p.y) return 'sink';
	const atWall = left ? p.x === 0 : p.x + w === W;
	if (!atWall) return left ? 'left' : 'right';
	if (p.y === FLOORS[cup.floor]) return left ? 'left' : 'right';
	return p.state === 'dwell' ? 'hurry' : null;
}

// One "think": applies the advice directly to the game.
export function step(game, rng = Math.random, skill = 1) {
	if (rng() > skill) return null;
	const a = advise(game);
	if (!a) return null;
	if (a === 'left') game.move(-1);
	else if (a === 'right') game.move(1);
	else if (a === 'rotate') game.rotate(1);
	else if (a === 'hurry') game.hurry();
	else if (a === 'sink') game.sink();
	else if (a.startsWith('close:')) game.closeDoor(Number(a.slice(6)));
	return a;
}
