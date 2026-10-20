// Tetromino shapes and helpers. A shape is a list of [x, y] cells,
// normalised so the smallest x and y are both 0.

export const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Spawn orientation of each type (flat where possible).
const BASE = {
	I: [[0, 0], [1, 0], [2, 0], [3, 0]],
	O: [[0, 0], [1, 0], [0, 1], [1, 1]],
	T: [[1, 0], [0, 1], [1, 1], [2, 1]],
	S: [[1, 0], [2, 0], [0, 1], [1, 1]],
	Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
	J: [[0, 0], [0, 1], [1, 1], [2, 1]],
	L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

export function normalise(cells) {
	let minX = Infinity;
	let minY = Infinity;
	for (const [x, y] of cells) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
	}
	return cells
		.map(([x, y]) => [x - minX, y - minY])
		.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function key(cells) {
	return normalise(cells).map(([x, y]) => x + ',' + y).join(';');
}

// Clockwise rotation (screen coordinates, y grows downwards).
export function rotateCW(cells) {
	return normalise(cells.map(([x, y]) => [-y, x]));
}

export function rotateCCW(cells) {
	return normalise(cells.map(([x, y]) => [y, -x]));
}

export function size(cells) {
	let w = 0;
	let h = 0;
	for (const [x, y] of cells) {
		if (x + 1 > w) w = x + 1;
		if (y + 1 > h) h = y + 1;
	}
	return { w, h };
}

export function baseShape(type) {
	return normalise(BASE[type]);
}

// Lookup table: normalised key of every rotation -> type.
const LOOKUP = new Map();
for (const t of TYPES) {
	let s = baseShape(t);
	for (let i = 0; i < 4; i++) {
		LOOKUP.set(key(s), t);
		s = rotateCW(s);
	}
}

// Identify which tetromino a set of four connected cells forms.
export function identify(cells) {
	if (cells.length !== 4) return null;
	return LOOKUP.get(key(cells)) || null;
}

// Classic-ish colours, a touch warmer to sit in a kitchen.
export const TYPE_COLOURS = {
	I: '#c9d3dc', // cutlery silver
	O: '#f4c542',
	T: '#a66bd6',
	S: '#5cc46a',
	Z: '#e85d5d',
	J: '#4f8ae8',
	L: '#f08c3a',
};
