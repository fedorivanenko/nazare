const DRAG_THRESHOLD = 5;

/**
 * Attaches pointer-driven drag behaviour to an element.
 *
 * Pointer capture and onStart are deferred until the drag threshold is crossed
 * so that child interactive elements (buttons, inputs) receive their events
 * normally for plain clicks.
 *
 * @param {HTMLElement} el
 * @param {{ onStart?: (initialDx: number) => void, onDelta?: (dx: number) => void, onEnd?: () => void }} callbacks
 * @returns {() => void} destroy
 */
export function attachDrag(el, { onStart, onDelta, onEnd } = {}) {
	let isDragging = false;
	let hasMoved = false;
	let startX = 0;

	el.classList.add("cursor-grab");

	function onPointerDown(e) {
		if (e.button !== 0) return;
		isDragging = true;
		hasMoved = false;
		startX = e.clientX;
	}

	function onPointerMove(e) {
		if (!isDragging) return;
		const dx = e.clientX - startX;
		if (!hasMoved && Math.abs(dx) > DRAG_THRESHOLD) {
			hasMoved = true;
			el.setPointerCapture(e.pointerId);
			el.classList.replace("cursor-grab", "cursor-grabbing");
			onStart?.(dx);
		}
		if (hasMoved) onDelta?.(dx);
	}

	function onPointerUp(e) {
		if (!isDragging) return;
		isDragging = false;
		if (hasMoved) {
			if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
			el.classList.replace("cursor-grabbing", "cursor-grab");
			onEnd?.();
		}
	}

	function onClickCapture(e) {
		if (hasMoved) {
			e.stopPropagation();
			e.preventDefault();
		}
	}

	function onDragStart(e) {
		e.preventDefault();
	}

	el.addEventListener("pointerdown", onPointerDown);
	el.addEventListener("pointermove", onPointerMove);
	el.addEventListener("pointerup", onPointerUp);
	el.addEventListener("pointercancel", onPointerUp);
	el.addEventListener("click", onClickCapture, true);
	el.addEventListener("dragstart", onDragStart);

	return function destroy() {
		el.removeEventListener("pointerdown", onPointerDown);
		el.removeEventListener("pointermove", onPointerMove);
		el.removeEventListener("pointerup", onPointerUp);
		el.removeEventListener("pointercancel", onPointerUp);
		el.removeEventListener("click", onClickCapture, true);
		el.removeEventListener("dragstart", onDragStart);
		el.classList.remove("cursor-grab", "cursor-grabbing");
	};
}
