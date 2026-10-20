// Screen layout, in cells. The column sits in the middle with a cupboard
// strip either side; above it is the score bar and worktop, below it the
// dishwasher kick plate.
import { W, H } from './game.js';

export const SIDE = 4; // visible cupboard depth either side
export const HUD = 2.2; // score bar height
export const TOP = 1.0; // worktop band with the cutlery drawer
export const BOTTOM = 1.3; // kick plate
export const COLS = SIDE * 2 + W;
export const ROWS = HUD + TOP + H + BOTTOM;

export function computeLayout(vw, vh) {
	const c = Math.max(8, Math.floor(Math.min(vw / COLS, vh / ROWS)));
	const width = c * COLS;
	const height = c * ROWS;
	const ox = Math.floor((vw - width) / 2);
	const oy = Math.floor((vh - height) / 2);
	const colX = ox + SIDE * c;
	const colY = oy + (HUD + TOP) * c;
	return {
		vw,
		vh,
		c,
		ox,
		oy,
		width,
		height,
		colX,
		colY,
		colW: W * c,
		colH: H * c,
		rightX: colX + W * c,
		hudY: oy,
		topY: oy + HUD * c,
		bottomY: colY + H * c,
	};
}

// Screen rectangle of cupboard idx (0..2 left, top to bottom; 3..5 right).
export function cupboardRect(L, idx) {
	const left = idx < 3;
	const floor = idx % 3;
	return {
		x: left ? L.ox : L.rightX,
		y: L.colY + floor * 2 * L.c,
		w: SIDE * L.c,
		h: 2 * L.c,
		left,
	};
}

// Which cupboard (if any) is under a screen point.
export function cupboardAt(L, px, py) {
	for (let i = 0; i < 6; i++) {
		const r = cupboardRect(L, i);
		if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return i;
	}
	return -1;
}
