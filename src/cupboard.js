// Cupboards sit either side of the top of the column, three a side, each
// two rows tall. A piece slides in sideways from the column and butts up
// against whatever is already on the shelf.
//
// Inside a cupboard we use local coordinates: u is the distance from the
// cupboard's back wall (the screen edge), growing towards the column, and r
// is the row (0 top, 1 bottom). Only the front profile matters for fitting:
// front[r] is the first free u in row r.

import { size } from './pieces.js';

export const CUPBOARD_ROWS = 2;

export function createCupboard(side, floor) {
	return {
		side, // 'L' or 'R'
		floor, // 0 top, 1 middle, 2 bottom
		type: null,
		front: [0, 0],
		items: [], // { type, cells: [[u, r]] }
		door: 'open', // 'open' | 'closing' | 'closed' | 'opening'
		doorT: 0,
		flash: 0,
	};
}

// Convert piece cells (normalised, screen orientation) to local (u, r).
// For a right-hand cupboard the piece is mirrored, because its back wall is
// on the right.
export function toLocal(cells, side) {
	const { w } = size(cells);
	return cells.map(([x, y]) => [side === 'L' ? x : w - 1 - x, y]);
}

// Work out where a piece would come to rest and whether it leaves a gap.
// Returns { ok, offset, gaps: [g0, g1], reason }.
export function fit(cup, cells) {
	const { h } = size(cells);
	if (h !== CUPBOARD_ROWS) return { ok: false, reason: 'shape', gaps: [0, 0], offset: 0 };
	const local = toLocal(cells, cup.side);
	const minU = [Infinity, Infinity];
	for (const [u, r] of local) if (u < minU[r]) minU[r] = u;
	const first = cup.items.length === 0;
	const front = first ? [0, 0] : cup.front;
	let offset = -Infinity;
	for (let r = 0; r < CUPBOARD_ROWS; r++) offset = Math.max(offset, front[r] - minU[r]);
	const gaps = [0, 1].map((r) => offset + minU[r] - front[r]);
	const ok = first || (gaps[0] === 0 && gaps[1] === 0);
	return { ok, offset, gaps, reason: ok ? null : 'gap' };
}

// Decide what happens when a piece of `type` is pushed into cupboard `idx`.
// Returns one of:
//   'blocked'  door shut or the piece is not two rows tall: acts as a wall
//   'store'    accepted
//   'wrong'    cupboard belongs to another type
//   'taken'    an empty cupboard, but this type already owns another one
//   'gap'      right cupboard, wrong way round: would leave a gap
export function judge(cupboards, idx, type, cells) {
	const cup = cupboards[idx];
	if (cup.door !== 'open') return 'blocked';
	if (type === 'I') return 'blocked';
	if (size(cells).h !== CUPBOARD_ROWS) return 'blocked';
	if (cup.type === null) {
		const owner = cupboards.findIndex((c, i) => i !== idx && c.type === type);
		return owner === -1 ? 'store' : 'taken';
	}
	if (cup.type !== type) return 'wrong';
	return fit(cup, cells).ok ? 'store' : 'gap';
}

// Put a piece on the shelf. Assumes judge() said 'store'.
export function store(cup, type, cells) {
	const f = fit(cup, cells);
	const local = toLocal(cells, cup.side).map(([u, r]) => [u + f.offset, r]);
	if (cup.items.length === 0) {
		cup.type = type;
		cup.front = [0, 0];
	}
	for (const [u, r] of local) if (u + 1 > cup.front[r]) cup.front[r] = u + 1;
	cup.items.push({ type, cells: local });
	return cup.items.length;
}

// How far the shelf contents have slid out of view (in cells) so the
// front stays visible through an opening `visible` cells deep.
export function scrollFor(cup, visible) {
	return Math.max(0, Math.max(cup.front[0], cup.front[1]) - visible);
}

export function empty(cup) {
	cup.type = null;
	cup.front = [0, 0];
	cup.items = [];
}

// Which orientation (if any) of a piece would fit right now. Used for the
// gentle hint glow; returns the cells or null.
export function fittingOrientation(cup, orientations) {
	for (const cells of orientations) if (fit(cup, cells).ok && size(cells).h === CUPBOARD_ROWS) return cells;
	return null;
}
