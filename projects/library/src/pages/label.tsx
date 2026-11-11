import React from "react";
import PageContainer from "@shared/components/page_container";
import SpotifyCard from "@shared/components/spotify_card";
import useDropdownMenu from "@shared/dropdown/useDropdownMenu";
import useSortDropdownMenu from "@shared/dropdown/useSortDropdownMenu";
import useStatus from "@shared/status/useStatus";
import { useInfiniteQuery } from "@shared/types/react_query";
import BackButton from "../components/back_button";
import LoadMoreCard from "../components/load_more_card";
import { type GroupPeriod, groupByPeriod } from "../utils/date_groups";

// Spotify's search supports a label: filter for albums. This uses the same
// internal GraphQL query as the Albums tab of Spotify's search page (the public
// Web API search doesn't return label results from inside the client). Results
// come from the whole catalog, so they include releases that aren't in the library.
const PAGE_SIZE = 50;

// The searchAlbums definition is only registered once Spotify's search page code
// has loaded. Until then, build it from the persisted-query hash used by Spotify
// 1.3.8; that hash changes between Spotify versions.
const SEARCH_ALBUMS_HASH = "202cb3305e31e5a0767ba7925f28bd728cf8f8b0217e6da43909056071cd70e9";

function getSearchAlbumsDefinition() {
	const { Definitions } = Spicetify.GraphQL;
	if (Definitions.searchAlbums) return Definitions.searchAlbums;

	// reuse the class of an always-loaded definition to build the missing one
	const Definition = Object.getPrototypeOf(Definitions.getAlbum)?.constructor;
	if (!Definition) throw new Error("Spotify's album search isn't available in this version.");
	return new Definition("searchAlbums", "query", SEARCH_ALBUMS_HASH, null);
}

interface Release {
	uri: string;
	name: string;
	year?: number;
	imageUrl?: string;
	artists: { name: string; uri: string }[];
}

interface SearchAlbumsResponse {
	data?: {
		searchV2?: {
			albumsV2?: {
				totalCount: number;
				items: {
					__typename: string;
					data?: {
						__typename: string;
						uri: string;
						name: string;
						date?: { year?: number };
						coverArt?: { sources?: { url: string; width?: number }[] };
						artists?: { items?: { uri: string; profile?: { name?: string } }[] };
					};
				}[];
			};
		};
	};
	errors?: { message?: string }[];
}

function toRelease(item: NonNullable<NonNullable<NonNullable<SearchAlbumsResponse["data"]>["searchV2"]>["albumsV2"]>["items"][number]): Release | null {
	const album = item.data;
	if (item.__typename !== "AlbumResponseWrapper" || album?.__typename !== "Album" || !album.uri) return null;
	const largestImage = [...(album.coverArt?.sources ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
	return {
		uri: album.uri,
		name: album.name,
		year: album.date?.year,
		imageUrl: largestImage?.url,
		artists: (album.artists?.items ?? []).map((artist) => ({ name: artist.profile?.name ?? "", uri: artist.uri })),
	};
}

const libraryFilterOptions = [
	{ id: "all", name: "All Releases" },
	{ id: "in-library", name: "In Library" },
	{ id: "not-in-library", name: "Not in Library" },
];

// Sorting happens client-side over the releases loaded so far. Clicking the
// active option again reverses it (handled by useSortDropdownMenu).
const sortOptions = [
	{ id: "year", name: "Release Year" },
	{ id: "name", name: "Name" },
	{ id: "artist", name: "Artist Name" },
	{ id: "relevance", name: "Relevance" },
];

type LabelRelease = Release & { inLibrary: boolean };

// Grouping options that make sense for each sort; Name and Relevance have none.
const yearGroupOptions = [
	{ id: "none", name: "No Grouping" },
	{ id: "year", name: "By Year" },
	{ id: "decade", name: "By Decade" },
];

const artistGroupOptions = [
	{ id: "none", name: "No Grouping" },
	{ id: "artist", name: "By Artist" },
];

interface ReleaseGroup {
	key: string;
	label: string;
	/** artist uri, when the heading should link to the artist */
	uri?: string;
	items: LabelRelease[];
}

/** Groups releases by primary artist, keeping the incoming (sorted) order. */
function groupByArtist(releases: LabelRelease[]): ReleaseGroup[] {
	const groups = new Map<string, ReleaseGroup>();
	for (const release of releases) {
		const artist = release.artists[0];
		const key = artist?.uri || "unknown";
		let group = groups.get(key);
		if (!group) {
			group = { key, label: artist?.name || "Unknown artist", uri: artist?.uri, items: [] };
			groups.set(key, group);
		}
		group.items.push(release);
	}
	return [...groups.values()];
}

function artistPath(uri: string) {
	return `/artist/${uri.split(":").pop()}`;
}

const sortName = (name = "") => name.replace(/^the\s+/i, "");

/** Compares in each option's natural direction: newest year, A to Z, best search match. */
function compareReleases(sortId: string) {
	const byName = (a: LabelRelease, b: LabelRelease) => sortName(a.name).localeCompare(sortName(b.name));
	switch (sortId) {
		case "year":
			// releases without a year count as oldest
			return (a: LabelRelease, b: LabelRelease) => (b.year ?? 0) - (a.year ?? 0);
		case "name":
			return byName;
		case "artist":
			return (a: LabelRelease, b: LabelRelease) =>
				sortName(a.artists[0]?.name).localeCompare(sortName(b.artists[0]?.name)) || byName(a, b);
		default:
			// search results already arrive in relevance order
			return () => 0;
	}
}

const InLibraryIcon = () => (
	<Spicetify.ReactComponent.IconComponent semanticColor="textBase" viewBox="0 0 16 16" iconSize={12}>
		<path d="M13.985 2.383 5.127 12.754 1.388 8.375l-.658.77 4.397 5.149 9.618-11.262z" />
	</Spicetify.ReactComponent.IconComponent>
);

const LabelPage = () => {
	const label = decodeURIComponent(Spicetify.Platform.History.location.pathname.split("/")[3] ?? "");
	const [libraryFilterDropdown, libraryFilterOption] = useDropdownMenu(libraryFilterOptions, "library:label-filter");
	const [sortDropdown, sortOption, isReversed] = useSortDropdownMenu(sortOptions, "library:label-sort");
	const [yearGroupDropdown, yearGroupOption] = useDropdownMenu(yearGroupOptions, "library:label-year-grouping");
	const [artistGroupDropdown, artistGroupOption] = useDropdownMenu(artistGroupOptions, "library:label-artist-grouping");
	const isYearSort = sortOption.id === "year";
	const isArtistSort = sortOption.id === "artist";

	const fetchReleases = async ({ pageParam }: { pageParam: number }) => {
		const res = (await Spicetify.GraphQL.Request(getSearchAlbumsDefinition(), {
			searchTerm: `label:"${label.replace(/"/g, "")}"`,
			offset: pageParam,
			limit: PAGE_SIZE,
			numberOfTopResults: 20,
			includeAudiobooks: false,
			includePreReleases: false,
			includeAlbumPreReleases: false,
			includeAuthors: false,
			includeEpisodeContentRatingsV2: false,
		})) as SearchAlbumsResponse;

		const results = res?.data?.searchV2?.albumsV2;
		if (!results) {
			const details = res?.errors?.map((e) => e.message).join("; ") || JSON.stringify(res)?.slice(0, 300);
			throw new Error(`Spotify search failed: ${details}`);
		}

		const albums = results.items.map(toRelease).filter((album): album is Release => album !== null);
		const inLibrary = albums.length
			? ((await Spicetify.Platform.LibraryAPI.contains(...albums.map((album) => album.uri))) as boolean[])
			: [];

		return {
			albums: albums.map((album, index) => ({ ...album, inLibrary: Boolean(inLibrary[index]) })),
			offset: pageParam,
			total: results.totalCount,
		};
	};

	const { data, status, error, hasNextPage, fetchNextPage } = useInfiniteQuery({
		queryKey: ["library:label", label],
		queryFn: fetchReleases,
		initialPageParam: 0,
		getNextPageParam: (lastPage) => {
			const next = lastPage.offset + PAGE_SIZE;
			if (next < lastPage.total) return next;
		},
		enabled: Boolean(label),
	});

	const props = {
		lhs: [<BackButton url="Albums" />, label || "Unknown label"],
		rhs: [
			libraryFilterDropdown,
			sortDropdown,
			isYearSort ? yearGroupDropdown : null,
			isArtistSort ? artistGroupDropdown : null,
		],
	};

	const Status = useStatus(status, error);
	if (Status) return <PageContainer {...props}>{Status}</PageContainer>;

	// The same release can show up more than once in search results.
	const seen = new Set<string>();
	const compare = compareReleases(sortOption.id);
	const releases = ((data as NonNullable<typeof data>).pages.flatMap((page) => page.albums) as LabelRelease[])
		.filter((album) => (seen.has(album.uri) ? false : (seen.add(album.uri), true)))
		.filter((album) => {
			if (libraryFilterOption.id === "in-library") return album.inLibrary;
			if (libraryFilterOption.id === "not-in-library") return !album.inLibrary;
			return true;
		})
		// the sort is stable, so ties keep the search's relevance order
		.sort((a, b) => (isReversed ? compare(b, a) : compare(a, b)));
	// relevance has no comparator to flip, so reverse the search order directly
	if (sortOption.id === "relevance" && isReversed) releases.reverse();

	if (releases.length === 0 && !hasNextPage) {
		const Empty = useStatus("error", new Error("No releases found for this label.")) as React.ReactElement;
		return <PageContainer {...props}>{Empty}</PageContainer>;
	}

	const renderCards = (items: LabelRelease[]) =>
		items.map((album) => (
			<SpotifyCard
				key={album.uri}
				type="album"
				uri={album.uri}
				header={album.name}
				subheader={[album.artists[0]?.name, album.year].filter(Boolean).join(" · ")}
				imageUrl={album.imageUrl}
				artistUri={album.artists[0]?.uri}
				badge={album.inLibrary ? <InLibraryIcon /> : undefined}
			/>
		));

	const loadMoreCard = hasNextPage ? <LoadMoreCard key="load-more" callback={fetchNextPage} /> : null;

	let groups: ReleaseGroup[] | null = null;
	if (isYearSort && yearGroupOption.id !== "none") {
		// only the release year is known, so place each release on January 1st of it
		groups = groupByPeriod(
			releases,
			(release) => (release.year ? new Date(release.year, 0, 1) : null),
			yearGroupOption.id as GroupPeriod,
		);
	} else if (isArtistSort && artistGroupOption.id === "artist") {
		groups = groupByArtist(releases);
	}

	if (groups) {
		return (
			<PageContainer {...props}>
				{groups.map((group, index) => (
					<section className="library-date-group" key={group.key}>
						<h2 className="library-date-group-title">
							{group.uri ? (
								<button
									type="button"
									className="library-group-link"
									title={`Open ${group.label}`}
									onClick={() => Spicetify.Platform.History.push(artistPath(group.uri as string))}
								>
									{group.label}
								</button>
							) : (
								group.label
							)}
						</h2>
						<div className={"main-gridContainer-gridContainer grid"}>
							{renderCards(group.items)}
							{index === (groups as ReleaseGroup[]).length - 1 && loadMoreCard}
						</div>
					</section>
				))}
			</PageContainer>
		);
	}

	return (
		<PageContainer {...props}>
			<div className={"main-gridContainer-gridContainer grid"}>
				{renderCards(releases)}
				{loadMoreCard}
			</div>
		</PageContainer>
	);
};

export default LabelPage;
