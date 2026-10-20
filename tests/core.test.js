import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, baseShape, rotateCW, rotateCCW, identify, key, normalise } from '../src/pieces.js';
import * as Stack from '../src/stack.js';
import * as Cup from '../src/cupboard.js';
import { Game, W, H, DRAWER_X, ZONE } from '../src/game.js';

const T_UP = baseShape('T'); // .X. / XXX
const T_DOWN = rotateCW(rotateCW(T_UP)); // XXX / .X.

test('every rotation of every tetromino is identified', () => {
	for (const t of TYPES) {
		let s = baseShape(t);
		for (let i = 0; i < 4; i++) {
			assert.equal(identify(s), t);
			s = rotateCW(s);
		}
		assert.equal(key(rotateCCW(rotateCW(baseShape(t)))), key(baseShape(t)));
	}
	assert.equal(identify([[0, 0], [1, 0], [2, 0]]), null);
});

test('S and Z, J and L stay distinct (no mirroring)', () => {
	assert.equal(identify(baseShape('S')), 'S');
	assert.equal(identify(baseShape('Z')), 'Z');
	assert.notEqual(identify(baseShape('J')), identify(baseShape('L')));
});

test('gravity drops dishes into holes', () => {
	const g = Stack.makeGrid(3, 4);
	g[0][1] = { k: 1 };
	g[2][1] = { k: 2 };
	const moves = Stack.applyGravity(g);
	assert.equal(g[3][1].k, 2);
	assert.equal(g[2][1].k, 1);
	assert.equal(g[0][1], null);
	assert.equal(moves.length, 2);
});

test('groups of four or more release one connected tetromino; junk never does', () => {
	const g = Stack.makeGrid(6, 3);
	// a row of five kind-0 dishes
	for (let x = 0; x < 5; x++) g[2][x] = { k: 0 };
	// three kind-1 dishes: not enough
	g[1][0] = { k: 1 };
	g[1][1] = { k: 1 };
	g[0][0] = { k: 1 };
	// four junk dishes
	for (let x = 2; x < 6; x++) g[1][x] = { k: Stack.JUNK };
	const c = Stack.findCandidates(g);
	assert.equal(c.length, 1);
	assert.equal(c[0].kind, 0);
	assert.equal(c[0].groupSize, 5);
	assert.equal(identify(c[0].cells), 'I');
});

test('washing turns adjacent junk into clean dishes', () => {
	const g = Stack.makeGrid(3, 2);
	g[1][0] = { k: Stack.JUNK };
	g[1][2] = { k: Stack.JUNK };
	const washed = Stack.washAround(g, [[1, 1]], Stack.makeRng(1), 3);
	assert.equal(washed.length, 2);
	assert.ok(g[1][0].k >= 0 && g[1][2].k >= 0);
});

test('random rows are never full and never nearly empty', () => {
	const rng = Stack.makeRng(7);
	for (let i = 0; i < 200; i++) {
		const n = Stack.randomRow(10, rng, i % 2 ? 1 : 0, 3).filter(Boolean).length;
		assert.ok(n >= 2 && n <= 9, `row had ${n}`);
	}
});

function cups() {
	const list = [];
	for (const side of ['L', 'R']) for (let f = 0; f < 3; f++) list.push(Cup.createCupboard(side, f));
	return list;
}

test('the first piece in a cupboard always goes in and claims it', () => {
	const c = cups();
	assert.equal(Cup.judge(c, 0, 'T', T_UP), 'store');
	Cup.store(c[0], 'T', T_UP);
	assert.equal(c[0].type, 'T');
	// T now owns cupboard 0, so an empty cupboard must turn T away
	assert.equal(Cup.judge(c, 1, 'T', T_UP), 'taken');
	// another type cannot use T's cupboard
	assert.equal(Cup.judge(c, 0, 'O', baseShape('O')), 'wrong');
	// I pieces and tall shapes cannot enter at all
	assert.equal(Cup.judge(c, 2, 'I', baseShape('I')), 'blocked');
	assert.equal(Cup.judge(c, 2, 'L', rotateCW(baseShape('L'))), 'blocked');
});

test('T pieces must alternate to fit without gaps', () => {
	const c = cups();
	Cup.store(c[0], 'T', T_UP);
	assert.equal(Cup.judge(c, 0, 'T', T_UP), 'gap');
	assert.equal(Cup.judge(c, 0, 'T', T_DOWN), 'store');
	Cup.store(c[0], 'T', T_DOWN);
	assert.equal(Cup.judge(c, 0, 'T', T_DOWN), 'gap');
	assert.equal(Cup.judge(c, 0, 'T', T_UP), 'store');
	assert.deepEqual(c[0].front, [5, 4]);
});

test('S, Z and O always tile with themselves', () => {
	for (const t of ['S', 'Z', 'O']) {
		const c = cups();
		for (let i = 0; i < 5; i++) {
			assert.equal(Cup.judge(c, 4, t, baseShape(t)), 'store', `${t} #${i}`);
			Cup.store(c[4], t, baseShape(t));
		}
	}
});

test('right-hand cupboards are mirrored', () => {
	const c = cups();
	const L1 = baseShape('L'); // ..X / XXX
	const L2 = rotateCW(rotateCW(L1)); // XXX / X..
	// On the left, after L2 (XXX/X..) the front is ragged and L1 fits next.
	Cup.store(c[0], 'L', L2);
	assert.equal(Cup.judge(c, 0, 'L', L1), 'store');
	assert.equal(Cup.judge(c, 0, 'L', L2), 'gap');
	// On the right the same first piece is seen from behind, so it is the
	// other orientation that fits.
	Cup.store(c[3], 'L', L2);
	assert.deepEqual(c[3].front, [3, 3]);
	assert.equal(Cup.judge(c, 3, 'L', L1), 'store');
	Cup.store(c[3], 'L', L1);
	assert.equal(Cup.judge(c, 3, 'L', L2), 'store');
});

test('shelf contents scroll out of view as the cupboard fills', () => {
	const c = cups();
	for (let i = 0; i < 3; i++) Cup.store(c[0], 'O', baseShape('O'));
	assert.equal(Cup.scrollFor(c[0], 4), 2);
});

// ---- game rules --------------------------------------------------------

function quietGame() {
	const g = new Game(42);
	g.reset(42);
	g.grid = Stack.makeGrid(W, H);
	g.candidates = [];
	g.settleT = 0;
	g.rowT = -1e9; // no new rows unless a test asks
	return g;
}

function launch(g, type, cells, x, y) {
	const p = { id: g.nextId++, type, kind: 0, cells: normalise(cells), x, y, state: 'rise', t: 0, hurry: false, vy: 0 };
	g.flying.push(p);
	return p;
}

test('a piece rises, pauses at a floor and can be pushed into a cupboard', () => {
	const g = quietGame();
	const p = launch(g, 'T', T_UP, 0, 6);
	for (let i = 0; i < 200 && p.y > 4; i++) g.update(0.05);
	assert.equal(p.y, 4);
	assert.equal(p.state, 'dwell');
	assert.equal(g.move(-1), 'store');
	assert.equal(g.cupboards[2].type, 'T');
	assert.equal(g.flying.length, 0);
	assert.ok(g.score > 0);
	assert.equal(g.stored, 1);
});

test('pushing a wall between floors just bumps', () => {
	const g = quietGame();
	const p = launch(g, 'O', baseShape('O'), 0, 9);
	assert.equal(g.move(-1), 'bump');
	assert.equal(p.state, 'rise');
});

test('a wrong cupboard rejects the piece and it lands as junk at the bottom', () => {
	const g = quietGame();
	Cup.store(g.cupboards[0], 'S', baseShape('S'));
	const p = launch(g, 'T', T_UP, 0, 0);
	p.state = 'ceiling';
	assert.equal(g.move(-1), 'wrong');
	for (let i = 0; i < 40; i++) g.update(0.05);
	assert.equal(g.flying.length, 0);
	const junk = g.grid.flat().filter((c) => c && c.k === Stack.JUNK).length;
	assert.equal(junk, 4);
	assert.equal(g.rejected, 1);
});

test('a piece that runs out of patience among the cupboards is rejected', () => {
	const g = quietGame();
	const p = launch(g, 'O', baseShape('O'), 4, 0);
	p.state = 'ceiling';
	const limit = g.t.patience;
	for (let i = 0; i < Math.floor(limit * 10) - 2; i++) g.update(0.1);
	assert.equal(g.rejected, 0, 'still waiting just before patience runs out');
	assert.ok(g.patienceUsed(p) > 0.9);
	for (let i = 0; i < 20; i++) g.update(0.1);
	assert.equal(g.flying.length, 0);
	assert.equal(g.rejected, 1);
});

test('a flat I in the cutlery drawer clears the bottom row', () => {
	const g = quietGame();
	for (let x = 0; x < W; x++) g.grid[H - 1][x] = { k: x % 3 };
	g.grid[H - 2][0] = { k: Stack.JUNK };
	const p = launch(g, 'I', baseShape('I'), DRAWER_X - 1, 0);
	p.state = 'ceiling';
	assert.equal(g.move(1), 'moved');
	assert.equal(g.flying.length, 0);
	assert.equal(g.drawerCount, 1);
	assert.equal(g.grid[H - 1][0].k, Stack.JUNK);
	assert.equal(g.grid[H - 1].filter(Boolean).length, 1);
});

test('closing a door banks a bonus and frees the cupboard for any type', () => {
	const g = quietGame();
	Cup.store(g.cupboards[1], 'O', baseShape('O'));
	Cup.store(g.cupboards[1], 'O', baseShape('O'));
	assert.equal(g.closeDoor(1), 20);
	assert.equal(g.closeDoor(1), 0);
	for (let i = 0; i < 30; i++) g.update(0.05);
	assert.equal(g.cupboards[1].door, 'open');
	assert.equal(g.cupboards[1].type, null);
	assert.equal(Cup.judge(g.cupboards, 1, 'Z', baseShape('Z')), 'store');
});

test('queued pieces wait below the cupboard zone', () => {
	const g = quietGame();
	const a = launch(g, 'O', baseShape('O'), 0, 8);
	const b = launch(g, 'O', baseShape('O'), 6, 12);
	for (let i = 0; i < 40; i++) g.update(0.05);
	assert.ok(a.y < ZONE);
	assert.equal(b.y, ZONE);
	assert.equal(g.active, a);
});

test('the game ends when the dishes reach the cupboards', () => {
	const g = quietGame();
	for (let y = ZONE; y < H; y++) for (let x = 0; x < W; x++) g.grid[y][x] = { k: Stack.JUNK };
	g.addRows([[{ k: Stack.JUNK }, ...Array(W - 1).fill(null)]]);
	assert.equal(g.mode, 'over');
});

test('random play from a seed is deterministic and eventually ends', () => {
	const run = () => {
		const g = new Game(5);
		g.reset(5);
		for (let i = 0; i < 20000 && g.mode === 'playing'; i++) g.update(1 / 30);
		return [g.mode, g.score, Math.round(g.time)];
	};
	const a = run();
	assert.deepEqual(a, run());
	assert.equal(a[0], 'over');
});

test('the uppermost flying piece is the one you steer, so nothing deadlocks', () => {
	const g = quietGame();
	const low = launch(g, 'O', baseShape('O'), 4, 16);
	const high = launch(g, 'O', baseShape('O'), 4, 9);
	assert.equal(g.active, high);
	for (let i = 0; i < 100; i++) g.update(0.05);
	assert.ok(high.y < ZONE, 'upper piece reached the cupboards');
	assert.ok(low.y >= ZONE && low.y < 16, 'lower piece rose and queued');
});

test('sinking drops the piece back one shelf, and not into the rack', () => {
	const g = quietGame();
	const p = launch(g, 'O', baseShape('O'), 4, 0);
	p.state = 'ceiling';
	assert.equal(g.sink(), true);
	assert.equal(p.y, 2);
	assert.equal(p.state, 'dwell');
	assert.equal(g.sink(), true);
	assert.equal(p.y, 4);
	assert.equal(g.sink(), false, 'no shelf below the bottom cupboards');
	// A shelf you went past can be used after sinking back to it.
	assert.equal(g.move(-1), 'moved');
	for (let i = 0; i < 3; i++) g.move(-1);
	assert.equal(g.move(-1), 'store');
	assert.equal(g.cupboards[2].type, 'O');
	// With the rack right up under the cupboards there is nowhere to sink.
	const g2 = quietGame();
	for (let x = 0; x < W; x++) g2.grid[ZONE][x] = { k: Stack.JUNK };
	const q = launch(g2, 'L', rotateCW(baseShape('L')), 4, 2);
	q.state = 'dwell';
	assert.equal(g2.sink(), false);
});

test('a tidy run scores more with each piece and a level shelf earns Neat', () => {
	const g = quietGame();
	const events = [];
	const put = (cells) => {
		const p = launch(g, 'O', cells, 0, 4);
		p.state = 'dwell';
		assert.equal(g.move(-1), 'store');
		events.push(...g.drainEvents().filter((e) => e.t === 'store'));
	};
	put(baseShape('O'));
	put(baseShape('O'));
	put(baseShape('O'));
	assert.deepEqual(events.map((e) => e.streak), [1, 2, 3]);
	assert.equal(events[0].neat, false, 'the first piece is never "neat"');
	assert.equal(events[1].neat, true);
	assert.ok(events[2].points > events[1].points && events[1].points > events[0].points);
	// A mistake breaks the run.
	const bad = launch(g, 'T', T_UP, 0, 4);
	bad.state = 'dwell';
	assert.equal(g.move(-1), 'wrong');
	assert.equal(g.streak, 0);
	assert.equal(g.bestStreak, 3);
});

test('shutting a door reports its bonus as a door event', () => {
	const g = quietGame();
	Cup.store(g.cupboards[4], 'S', baseShape('S'));
	Cup.store(g.cupboards[4], 'S', baseShape('S'));
	Cup.store(g.cupboards[4], 'S', baseShape('S'));
	g.drainEvents();
	assert.equal(g.closeDoor(4), 5 * 9);
	const e = g.drainEvents().find((x) => x.t === 'door');
	assert.deepEqual([e.cup, e.n, e.bonus], [4, 3, 45]);
});

test('tall columns topple onto lower neighbours, so the rack never spires', () => {
	const g = Stack.makeGrid(5, 10);
	for (let y = 2; y < 10; y++) g[y][2] = { k: y % 3 };
	const moves = Stack.topple(g);
	assert.ok(moves.length > 0);
	const hs = Stack.heights(g);
	for (let x = 1; x < 5; x++) assert.ok(Math.abs(hs[x] - hs[x - 1]) <= 2, `heights ${hs}`);
	assert.equal(hs.reduce((a, b) => a + b, 0), 8, 'no dish lost');
	for (const m of moves) assert.equal(g[m.toY][m.toX], m.cell);
});

test('emptying the whole rack pays a big bonus', () => {
	const g = quietGame();
	g.grid[H - 1][0] = { k: 1 };
	g.grid[H - 1][1] = { k: 1 };
	g.grid[H - 1][2] = { k: 1 };
	g.grid[H - 1][3] = { k: 1 };
	g.candidates = Stack.findCandidates(g.grid);
	g.launchT = 10;
	const before = g.score;
	g.tryLaunch();
	const e = g.drainEvents().find((x) => x.t === 'empty');
	assert.ok(e, 'empty event');
	assert.equal(g.score - before, 1000);
	assert.equal(g.emptied, 1);
});

test('the autopilot sinks back for a shelf it has passed', async () => {
	const { advise } = await import('../src/bot.js');
	const g = quietGame();
	// O already owns the bottom-left cupboard; the piece is above it.
	Cup.store(g.cupboards[2], 'O', baseShape('O'));
	g.cupboards[0].door = 'closed';
	g.cupboards[1].door = 'closed';
	for (const i of [3, 4, 5]) g.cupboards[i].door = 'closed';
	const p = launch(g, 'O', baseShape('O'), 0, 0);
	p.state = 'ceiling';
	assert.equal(advise(g), 'sink');
});
