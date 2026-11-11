// Details that LibraryAPI.getContents doesn't include (release date, label) are
// looked up per album through Spotify's own GraphQL getAlbum query and cached in
// local storage. They don't change, so each album is only fetched once.

const CACHE_KEY = "library:album-details";
const LEGACY_CACHE_KEY = "library:release-dates"; // date-only cache from an earlier version
const CONCURRENCY = 8;

export interface AlbumDetails {
	releaseDate: Date | null;
	label: string | null;
}

/** Compact cache entry: d = "YYYY", "YYYY-MM" or "YYYY-MM-DD", l = label; "" when Spotify has none. */
interface CachedDetails {
	d: string;
	l: string;
}

type DetailsCache = Record<string, CachedDetails>;

function loadCache(): DetailsCache {
	Spicetify.LocalStorage.remove(LEGACY_CACHE_KEY);
	try {
		return JSON.parse(Spicetify.LocalStorage.get(CACHE_KEY) || "{}");
	} catch {
		return {};
	}
}

function saveCache(cache: DetailsCache) {
	Spicetify.LocalStorage.set(CACHE_KEY, JSON.stringify(cache));
}

async function fetchDetails(uri: string): Promise<CachedDetails> {
	const res = (await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getAlbum, {
		uri,
		offset: 0,
		limit: 1,
		locale: Spicetify.Locale.getLocale(),
	})) as { data?: { albumUnion?: { date?: { isoString?: string | Date }; label?: string } } };

	const album = res?.data?.albumUnion;
	const iso = album?.date?.isoString;
	return {
		d: iso ? (iso instanceof Date ? iso.toISOString() : String(iso)).slice(0, 10) : "",
		l: album?.label?.trim() ?? "",
	};
}

/** Parses a cached release date as a local date, so the year never shifts with the time zone. */
function parseReleaseDate(value: string): Date | null {
	const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value);
	if (!match) return null;
	const [, year, month, day] = match;
	return new Date(Number(year), month ? Number(month) - 1 : 0, day ? Number(day) : 1);
}

/**
 * Returns details for each album uri, fetching the ones not cached yet.
 * Albums whose lookup fails have no details and are retried on the next call.
 */
export async function getAlbumDetails(
	uris: string[],
	onProgress?: (done: number, total: number) => void,
): Promise<Map<string, AlbumDetails>> {
	if (!Spicetify.GraphQL?.Definitions?.getAlbum) {
		throw new Error("Spotify's album lookup isn't available in this version, so album details can't be loaded.");
	}

	const cache = loadCache();
	const missing = uris.filter((uri) => !(uri in cache));
	let done = uris.length - missing.length;
	let next = 0;
	onProgress?.(done, uris.length);

	const worker = async () => {
		while (next < missing.length) {
			const uri = missing[next++];
			try {
				cache[uri] = await fetchDetails(uri);
			} catch {
				// leave uncached so it is retried next time
			}
			done++;
			onProgress?.(done, uris.length);
		}
	};

	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
	if (missing.length > 0) saveCache(cache);

	return new Map(
		uris.map((uri) => {
			const cached = cache[uri];
			return [
				uri,
				{
					releaseDate: cached?.d ? parseReleaseDate(cached.d) : null,
					label: cached?.l || null,
				},
			];
		}),
	);
}
