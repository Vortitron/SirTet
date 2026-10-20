// The dishwasher rack: a grid of crockery at the bottom of the column.
// grid[y][x] is null or a cell { k } where k is a dish kind (0..n-1) or
// JUNK for a chipped plate from a rejected piece. Row 0 is the top.

export const JUNK = -1;

export function makeGrid(w, h) {
	return Array.from({ length: h }, () => Array(w).fill(null));
}

export function cloneGrid(grid) {
	return grid.map((row) => row.map((c) => (c ? { ...c } : null)));
}

// Seeded PRNG (mulberry32) so games and tests are reproducible.
export function makeRng(seed = Date.now()) {
	let a = seed >>> 0;
	return function rng() {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// A fresh row of random dishes. At least one gap and at least two dishes,
// so a row never looks like a classic completed line.
export function randomRow(w, rng, density, kinds) {
	const row = Array(w).fill(null);
	let filled = 0;
	for (let x = 0; x < w; x++) {
		if (rng() < density) {
			row[x] = { k: Math.floor(rng() * kinds) };
			filled++;
		}
	}
	if (filled === w) row[Math.floor(rng() * w)] = null;
	while (filled < 2) {
		const x = Math.floor(rng() * w);
		if (!row[x]) {
			row[x] = { k: Math.floor(rng() * kinds) };
			filled++;
		}
	}
	return row;
}

// Push rows in at the bottom (rows[0] ends up highest). Everything shifts up.
// Returns true if any dish was pushed off the top of the grid.
export function pushRows(grid, rows) {
	let overflow = false;
	for (const row of rows) {
		const top = grid.shift();
		if (top.some((c) => c)) overflow = true;
		grid.push(row);
	}
	return overflow;
}

// Dishes drop straight down into holes. Returns the moves made so the
// renderer can animate them: [{ x, from, to }].
export function applyGravity(grid) {
	const h = grid.length;
	const w = grid[0].length;
	const moves = [];
	for (let x = 0; x < w; x++) {
		let write = h - 1;
		for (let y = h - 1; y >= 0; y--) {
			const c = grid[y][x];
			if (!c) continue;
			if (y !== write) {
				grid[write][x] = c;
				grid[y][x] = null;
				moves.push({ x, from: y, to: write });
			}
			write--;
		}
	}
	return moves;
}

// Column heights of a settled grid (dishes stacked from the bottom).
export function heights(grid) {
	const h = grid.length;
	return grid[0].map((_, x) => {
		let n = 0;
		while (n < h && grid[h - 1 - n][x]) n++;
		return n;
	});
}

// After gravity: a dish on top of a column that stands more than `slope`
// higher than a neighbour slides off onto the lower side, like a pile of
// plates settling. Assumes the grid is already settled. Returns the moves
// [{ cell, fromX, fromY, toX, toY }] for the renderer.
export function topple(grid, slope = 2) {
	const h = grid.length;
	const w = grid[0].length;
	const hs = heights(grid);
	const moves = [];
	for (let guard = 0; guard < w * h; guard++) {
		let best = null;
		for (let x = 0; x < w; x++) {
			for (const nx of [x - 1, x + 1]) {
				if (nx < 0 || nx >= w) continue;
				const drop = hs[x] - hs[nx];
				if (drop > slope && (!best || drop > best.drop)) best = { x, nx, drop };
			}
		}
		if (!best) break;
		const fromY = h - hs[best.x];
		const toY = h - 1 - hs[best.nx];
		const cell = grid[fromY][best.x];
		grid[toY][best.nx] = cell;
		grid[fromY][best.x] = null;
		hs[best.x]--;
		hs[best.nx]++;
		moves.push({ cell, fromX: best.x, fromY, toX: best.nx, toY });
	}
	return moves;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Find dishes ready to become a flying piece. Any connected group of four
// or more same-kind dishes releases one tetromino: the first four dishes
// found by a breadth-first search from the group's top-left dish (a BFS
// prefix is always connected). Results are ordered topmost first.
export function findCandidates(grid) {
	const h = grid.length;
	const w = grid[0].length;
	const seen = makeGrid(w, h).map((r) => r.map(() => false));
	const out = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const c = grid[y][x];
			if (!c || seen[y][x] || c.k === JUNK) continue;
			// Rows are scanned top-down, left to right, so (x, y) is the
			// top-left dish of its group.
			const order = [];
			const queue = [[x, y]];
			seen[y][x] = true;
			while (queue.length) {
				const [cx, cy] = queue.shift();
				order.push([cx, cy]);
				for (const [dx, dy] of DIRS) {
					const nx = cx + dx;
					const ny = cy + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny][nx]) continue;
					const n = grid[ny][nx];
					if (n && n.k === c.k) {
						seen[ny][nx] = true;
						queue.push([nx, ny]);
					}
				}
			}
			if (order.length >= 4) out.push({ kind: c.k, cells: order.slice(0, 4), groupSize: order.length });
		}
	}
	out.sort((a, b) => minY(a.cells) - minY(b.cells) || minX(a.cells) - minX(b.cells));
	return out;
}

function minY(cells) {
	return Math.min(...cells.map((c) => c[1]));
}
function minX(cells) {
	return Math.min(...cells.map((c) => c[0]));
}

export function removeCells(grid, cells) {
	for (const [x, y] of cells) grid[y][x] = null;
}

// Junk next to a lifted piece gets washed clean (given a random kind).
// Returns the washed positions.
export function washAround(grid, cells, rng, kinds) {
	const washed = [];
	const h = grid.length;
	const w = grid[0].length;
	for (const [x, y] of cells) {
		for (const [dx, dy] of DIRS) {
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const n = grid[ny][nx];
			if (n && n.k === JUNK) {
				n.k = Math.floor(rng() * kinds);
				washed.push([nx, ny]);
			}
		}
	}
	return washed;
}

// Row index of the highest dish, or grid height if empty.
export function stackTop(grid) {
	for (let y = 0; y < grid.length; y++) if (grid[y].some((c) => c)) return y;
	return grid.length;
}

export function countCells(grid) {
	let n = 0;
	for (const row of grid) for (const c of row) if (c) n++;
	return n;
}
