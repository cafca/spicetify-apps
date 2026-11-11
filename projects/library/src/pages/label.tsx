import React from "react";
import PageContainer from "@shared/components/page_container";
import SpotifyCard from "@shared/components/spotify_card";
import useDropdownMenu from "@shared/dropdown/useDropdownMenu";
import useStatus from "@shared/status/useStatus";
import { useInfiniteQuery } from "@shared/types/react_query";
import BackButton from "../components/back_button";
import LoadMoreCard from "../components/load_more_card";

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

const InLibraryIcon = () => (
	<Spicetify.ReactComponent.IconComponent semanticColor="textBase" viewBox="0 0 16 16" iconSize={12}>
		<path d="M13.985 2.383 5.127 12.754 1.388 8.375l-.658.77 4.397 5.149 9.618-11.262z" />
	</Spicetify.ReactComponent.IconComponent>
);

const LabelPage = () => {
	const label = decodeURIComponent(Spicetify.Platform.History.location.pathname.split("/")[3] ?? "");
	const [libraryFilterDropdown, libraryFilterOption] = useDropdownMenu(libraryFilterOptions, "library:label-filter");

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
		rhs: [libraryFilterDropdown],
	};

	const Status = useStatus(status, error);
	if (Status) return <PageContainer {...props}>{Status}</PageContainer>;

	// The same release can show up more than once in search results.
	const seen = new Set<string>();
	const releases = (data as NonNullable<typeof data>).pages
		.flatMap((page) => page.albums)
		.filter((album) => (seen.has(album.uri) ? false : (seen.add(album.uri), true)))
		.filter((album) => {
			if (libraryFilterOption.id === "in-library") return album.inLibrary;
			if (libraryFilterOption.id === "not-in-library") return !album.inLibrary;
			return true;
		})
		// newest year first; search only returns the year, so ties keep search order
		.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

	if (releases.length === 0 && !hasNextPage) {
		const Empty = useStatus("error", new Error("No releases found for this label.")) as React.ReactElement;
		return <PageContainer {...props}>{Empty}</PageContainer>;
	}

	return (
		<PageContainer {...props}>
			<div className={"main-gridContainer-gridContainer grid"}>
				{releases.map((album) => (
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
				))}
				{hasNextPage ? <LoadMoreCard key="load-more" callback={fetchNextPage} /> : null}
			</div>
		</PageContainer>
	);
};

export default LabelPage;
