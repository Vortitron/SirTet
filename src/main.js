// Wires the game, renderer, input and sound together and runs the loop.
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { step as botStep } from './bot.js';
import { makeRng } from './stack.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const titleEl = $('title');
const overEl = $('over');
const pauseEl = $('paused');
const hudEl = $('hud-buttons');
const pauseBtn = $('pause-btn');
const muteBtn = $('mute-btn');
const fmt = (n) => Number(n).toLocaleString('en-GB');

function readBest() {
	try {
		return Number(localStorage.getItem('sirtet.best')) || 0;
	} catch {
		return 0;
	}
}

function saveBest(v) {
	try {
		localStorage.setItem('sirtet.best', String(v));
	} catch {
		// storage unavailable: best only lasts this session
	}
}

const params = new URLSearchParams(location.search);
const fixedSeed = params.has('seed') ? Number(params.get('seed')) : null;
const demoEnabled = params.get('demo') !== '0';

// The demo behind the title screen: the autopilot plays a real game,
// slowed a little and making the odd mistake so it looks human.
function demoGame() {
	const g = new Game(fixedSeed ?? 7);
	g.reset(fixedSeed ?? 7);
	return g;
}

const app = {
	game: demoGame(),
	demo: true,
	demoT: 0,
	demoRng: makeRng(99),
	sound: new Sound(),
	best: readBest(),
	start() {
		this.game = new Game(fixedSeed ?? Date.now());
		this.game.reset(fixedSeed ?? Date.now());
		this.game.best = this.best;
		this.demo = false;
		this.renderer.setGame(this.game);
		titleEl.hidden = true;
		overEl.hidden = true;
		pauseEl.hidden = true;
		// A game-over card still on its way belongs to the old game.
		clearTimeout(overTimer);
		overTimer = 0;
		overShown = false;
		this.sound.unlock();
		syncButtons();
		canvas.focus({ preventScroll: true });
	},
	togglePause() {
		const g = this.game;
		if (this.demo) return;
		if (g.mode === 'playing') g.pause(true);
		else if (g.mode === 'paused') g.pause(false);
		pauseEl.hidden = g.mode !== 'paused';
		if (g.mode === 'paused') $('resume').focus({ preventScroll: true });
		else canvas.focus({ preventScroll: true });
		syncButtons();
	},
	// Enter only starts a new game once the game-over card is up, so a
	// stray press in the moment after the stack tops out cannot skip it.
	canRestart() {
		return this.demo || (this.game.mode === 'over' && !overEl.hidden);
	},
	toggleMute() {
		this.renderer.muted = this.sound.toggle();
		syncButtons();
	},
};
app.game.best = app.best;
app.renderer = new Renderer(canvas, app.game);
app.renderer.muted = app.sound.muted;
app.input = new Input(canvas, app);
window.__sirtet = app;

function syncButtons() {
	const g = app.game;
	const playing = !app.demo && (g.mode === 'playing' || g.mode === 'paused');
	pauseBtn.hidden = !playing;
	const paused = g.mode === 'paused';
	pauseBtn.setAttribute('aria-label', paused ? 'Carry on' : 'Pause');
	pauseBtn.classList.toggle('is-paused', paused);
	muteBtn.setAttribute('aria-pressed', String(!app.sound.muted));
	muteBtn.setAttribute('aria-label', app.sound.muted ? 'Sound off' : 'Sound on');
	muteBtn.classList.toggle('is-muted', app.sound.muted);
}

$('start').addEventListener('click', () => app.start());
$('again').addEventListener('click', () => app.start());
$('resume').addEventListener('click', () => app.togglePause());
pauseBtn.addEventListener('click', () => app.togglePause());
muteBtn.addEventListener('click', () => {
	app.sound.unlock();
	app.toggleMute();
	// Hand the keyboard back to the game, so Space means "next shelf".
	if (!app.demo && app.game.mode === 'playing') canvas.focus({ preventScroll: true });
});
$('best-title').textContent = fmt(app.best);
syncButtons();

// Keep the HTML buttons sitting on the painted score bar.
function placeHud() {
	const b = app.renderer.hudButtons();
	hudEl.style.left = b.x + 'px';
	hudEl.style.top = b.y + 'px';
	hudEl.style.height = b.h + 'px';
	hudEl.style.setProperty('--btn', b.h + 'px');
	hudEl.style.setProperty('--gap', b.gap + 'px');
}

// A hint that the title card scrolls when it does not fit.
const cardBody = document.querySelector('#title .body');
function markScroll() {
	const more = cardBody.scrollHeight - cardBody.scrollTop - cardBody.clientHeight > 4;
	cardBody.classList.toggle('more', more);
}
cardBody.addEventListener('scroll', markScroll, { passive: true });

function resize() {
	app.renderer.resize(window.innerWidth, window.innerHeight, Math.min(3, window.devicePixelRatio || 1));
	placeHud();
	markScroll();
}
window.addEventListener('resize', resize);
resize();

document.addEventListener('visibilitychange', () => {
	if (document.hidden && !app.demo && app.game.mode === 'playing') app.togglePause();
});

// Record the best score the moment a game ends, not when the card shows.
function recordBest(g) {
	const newBest = g.score > app.best;
	if (newBest) {
		app.best = g.score;
		saveBest(g.score);
	}
	return newBest;
}

function showOver(g, newBest) {
	overTimer = 0;
	if (app.game !== g || app.demo) return;
	$('final-score').textContent = fmt(g.score);
	$('final-stored').textContent = fmt(g.stored);
	$('final-level').textContent = String(g.level);
	$('final-streak').textContent = String(g.bestStreak);
	$('final-best').textContent = fmt(app.best);
	$('final-new').hidden = !newBest || g.score === 0;
	const bits = [`${g.drawerCount} cutlery drawer${g.drawerCount === 1 ? '' : 's'}`, `${g.rejected} sent back`];
	if (g.emptied) bits.push(`dishwasher emptied ${g.emptied === 1 ? 'once' : g.emptied + ' times'}`);
	$('final-stats').textContent = bits.join(', ');
	$('best-title').textContent = fmt(app.best);
	overEl.hidden = false;
	syncButtons();
	$('again').focus({ preventScroll: true });
}

function runDemo(dt) {
	const g = app.game;
	g.update(dt);
	app.demoT -= dt;
	if (app.demoT <= 0) {
		app.demoT = 0.22 + 0.2 * app.demoRng();
		botStep(g, app.demoRng, 0.93);
	}
	if (g.mode === 'over') {
		app.game = demoGame();
		app.game.reset(Math.floor(app.demoRng() * 1e9));
		app.renderer.setGame(app.game);
	}
}

let last = performance.now();
let overShown = false;
let overTimer = 0;
function loop(now) {
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;
	if (app.demo) {
		if (demoEnabled) runDemo(dt);
		for (const e of app.game.drainEvents()) app.renderer.onEvent(e);
	} else {
		const g = app.game;
		app.input.update(dt);
		g.update(dt);
		for (const e of g.drainEvents()) {
			app.renderer.onEvent(e);
			app.sound.play(e);
		}
		if (g.mode === 'over' && !overShown) {
			overShown = true;
			const newBest = recordBest(g);
			syncButtons();
			overTimer = setTimeout(() => showOver(g, newBest), 700);
		}
	}
	app.renderer.frame(app.game.mode === 'paused' ? 0 : dt);
	requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
