// Adds "• <label>" after the artist name in the header of Spotify's album pages,
// linking to the Library app's page for that label.
import { getAlbumDetails } from "../utils/album_details";
import { labelPagePath } from "../utils/label_path";

const LINK_CLASS = "library-album-label";

let observer: MutationObserver | null = null;

function albumUriFromPath(pathname: string) {
	const match = /^\/album\/([A-Za-z0-9]+)/.exec(pathname);
	return match ? `spotify:album:${match[1]}` : null;
}

/** The element holding the (last) artist name in the album header's metadata row. */
function findArtistItem(): Element | null {
	const page = document.querySelector('[data-testid="album-page"]');
	const links = Array.from(page?.querySelectorAll('[data-testid="creator-link"]') ?? []);
	if (links.length === 0) return null;

	// climb out of single-child wrappers so the label lands next to the artist, not inside the link
	const itemOf = (link: Element) => {
		let item = link;
		while (item.parentElement && item.parentElement.childElementCount === 1) item = item.parentElement;
		return item;
	};

	// the header comes first; with several artists, use the last one in the same row
	const first = itemOf(links[0]);
	const row = first.parentElement;
	return links.map(itemOf).filter((item) => item.parentElement === row).pop() ?? first;
}

function createLabelElement(albumUri: string, label: string) {
	const wrapper = document.createElement("span");
	wrapper.className = LINK_CLASS;
	wrapper.dataset.albumUri = albumUri;
	wrapper.style.cssText = "display: inline-flex; align-items: center; white-space: nowrap;";

	const separator = document.createElement("span");
	separator.textContent = "•";
	separator.setAttribute("aria-hidden", "true");
	separator.style.cssText = "margin: 0 4px; color: var(--text-subdued, #b3b3b3);";

	const link = document.createElement("a");
	link.textContent = label;
	link.href = "#";
	link.title = `Show all releases from ${label}`;
	link.style.cssText = "color: var(--text-subdued, #b3b3b3); text-decoration: none; cursor: pointer;";
	link.addEventListener("mouseenter", () => {
		link.style.color = "var(--text-base, #fff)";
		link.style.textDecoration = "underline";
	});
	link.addEventListener("mouseleave", () => {
		link.style.color = "var(--text-subdued, #b3b3b3)";
		link.style.textDecoration = "none";
	});
	link.addEventListener("click", (event) => {
		event.preventDefault();
		Spicetify.Platform.History.push(labelPagePath(label));
	});

	wrapper.append(separator, link);
	return wrapper;
}

async function showLabelForCurrentAlbum() {
	observer?.disconnect();
	observer = null;

	const albumUri = albumUriFromPath(Spicetify.Platform.History.location.pathname);
	if (!albumUri) return;

	let label: string | null = null;
	try {
		label = (await getAlbumDetails([albumUri])).get(albumUri)?.label ?? null;
	} catch (error) {
		console.warn("library - couldn't load the album's label", error);
	}
	// bail if there's no label or the user has already moved on
	if (!label || albumUriFromPath(Spicetify.Platform.History.location.pathname) !== albumUri) return;

	// Spotify renders the header asynchronously and may re-render it, so keep the link in place
	const ensureLink = () => {
		if (document.querySelector(`.${LINK_CLASS}[data-album-uri="${albumUri}"]`)) return;
		for (const stale of Array.from(document.querySelectorAll(`.${LINK_CLASS}`))) stale.remove();
		findArtistItem()?.after(createLabelElement(albumUri, label as string));
	};

	ensureLink();
	let frame = 0;
	observer = new MutationObserver(() => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(ensureLink);
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

export function initAlbumLabelLinks() {
	const { History } = Spicetify.Platform;
	if (!History || !Spicetify.GraphQL?.Definitions?.getAlbum) {
		setTimeout(initAlbumLabelLinks, 100);
		return;
	}
	History.listen(() => void showLabelForCurrentAlbum());
	void showLabelForCurrentAlbum();
}
