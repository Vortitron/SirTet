// Headless balancing run: plays many games with the autopilot at a human
// pace and prints how long they last. Usage:
//   node tools/sim.js [games] [reactionMs] [mistakeRate] [maxSeconds]
// A reaction of 0 means "idle": nobody touches anything.
import { Game } from '../src/game.js';
import { advise } from '../src/bot.js';
import { makeRng } from '../src/stack.js';

const games = Number(process.argv[2] || 20);
const reaction = Number(process.argv[3] ?? 260);
const mistakes = Number(process.argv[4] ?? 0.06);
const maxT = Number(process.argv[5] || 900);
const DT = 1 / 60;

function apply(g, a) {
	if (a === 'left') g.move(-1);
	else if (a === 'right') g.move(1);
	else if (a === 'rotate') g.rotate(1);
	else if (a === 'hurry') g.hurry();
	else if (a === 'sink') g.sink();
	else if (a && a.startsWith('close:')) g.closeDoor(Number(a.slice(6)));
}

const out = [];
for (let n = 0; n < games; n++) {
	const g = new Game(1000 + n);
	g.reset(1000 + n);
	const rng = makeRng(77 + n);
	let next = 0;
	let launches = 0;
	let firstLaunch = null;
	let early = 0;
	const levelAt = {};
	while (g.mode === 'playing' && g.time < maxT) {
		g.update(DT);
		for (const e of g.drainEvents()) {
			if (e.t === 'launch') {
				launches++;
				if (firstLaunch === null) firstLaunch = g.time;
				if (g.time < 60) early++;
			}
			if (e.t === 'level') levelAt[e.level] = Math.round(g.time);
		}
		if (reaction > 0 && g.time >= next) {
			next = g.time + (reaction * (0.8 + 0.4 * rng())) / 1000;
			if (rng() < mistakes) apply(g, ['left', 'right', 'rotate', 'hurry'][Math.floor(rng() * 4)]);
			else apply(g, advise(g));
		}
	}
	out.push({ t: Math.round(g.time), score: g.score, level: g.level, stored: g.stored, rejected: g.rejected, drawer: g.drawerCount, launches, early, perMin: +(launches / (g.time / 60)).toFixed(1), l5: levelAt[5], l10: levelAt[10] });
}
const avg = (k) => (out.reduce((s, o) => s + (o[k] || 0), 0) / out.length).toFixed(1);
for (const o of out) console.log(JSON.stringify(o));
console.log(`mean t ${avg('t')}s, level ${avg('level')}, stored ${avg('stored')}, rejected ${avg('rejected')}, pieces/min ${avg('perMin')}, first minute ${avg('early')}, score ${avg('score')}`);
const ts = out.map((o) => o.t).sort((a, b) => a - b);
console.log(`t min ${ts[0]} median ${ts[Math.floor(ts.length / 2)]} max ${ts[ts.length - 1]}`);
