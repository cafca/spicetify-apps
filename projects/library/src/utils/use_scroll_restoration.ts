import { useEffect } from "react";

// Scroll positions per page view, kept for the Spotify session. Spotify scrolls
// its main view back to the top on every navigation, so pages that want to keep
// their place (e.g. after opening a label and going back) record it themselves.
const positions = new Map<string, number>();

/** Spotify's main view scroll container: the nearest scrollable ancestor of the app. */
function findScrollContainer(): HTMLElement | null {
	for (let node = document.getElementById("library-app")?.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === "auto" || overflowY === "scroll") return node;
	}
	return null;
}

/**
 * Remembers the scroll position of a page while it's open and restores it
 * when the page is shown again.
 * @param key identifies the view; use a different key per sort/filter so each keeps its own position
 * @param pathPrefix only scrolling while the current route starts with this is recorded
 * @param ready true once the content is rendered at full height
 */
export function useScrollRestoration(key: string, pathPrefix: string, ready: boolean) {
	useEffect(() => {
		const container = findScrollContainer();
		if (!container) return;

		let frame = 0;
		const record = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				// ignore the reset to the top that happens while navigating away
				if (!Spicetify.Platform.History.location.pathname.startsWith(pathPrefix)) return;
				positions.set(key, container.scrollTop);
			});
		};

		container.addEventListener("scroll", record, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			container.removeEventListener("scroll", record);
		};
	}, [key, pathPrefix]);

	useEffect(() => {
		if (!ready) return;
		const target = positions.get(key);
		const container = findScrollContainer();
		if (!target || !container) return;

		// the grid may still be growing for a few frames, so retry until the position sticks
		let frame = 0;
		let attempts = 0;
		const restore = () => {
			container.scrollTop = target;
			if (Math.abs(container.scrollTop - target) > 1 && attempts++ < 60) {
				frame = requestAnimationFrame(restore);
			}
		};
		restore();
		return () => cancelAnimationFrame(frame);
	}, [key, ready]);
}
