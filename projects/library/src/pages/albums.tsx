import React, { useEffect } from "react";
import SearchBar from "../components/searchbar";
import type { ConfigWrapper } from "../types/library_types";
import SettingsButton from "@shared/components/settings_button";
import useDropdownMenu from "@shared/dropdown/useDropdownMenu";
import PageContainer from "@shared/components/page_container";
import SpotifyCard from "@shared/components/spotify_card";
import LoadMoreCard from "../components/load_more_card";
import AddButton from "../components/add_button";
import TextInputDialog from "../components/text_input_dialog";
import LeadingIcon from "../components/leading_icon";
import useStatus from "@shared/status/useStatus";
import { useInfiniteQuery, useQuery } from "@shared/types/react_query";
import type { AlbumItem, GetContentsResponse, UpdateEvent } from "../types/platform";
import PinIcon from "../components/pin_icon";
import useSortDropdownMenu from "@shared/dropdown/useSortDropdownMenu";
import collectionSort from "../utils/collection_sort";
import {
	DATE_ADDED_SORT,
	RECENTS_SORT,
	RELEASE_DATE_SORT,
	type GroupPeriod,
	getGroupDate,
	groupByPeriod,
} from "../utils/date_groups";
import { type AlbumDetails, getAlbumDetails } from "../utils/album_details";
import { groupByLabel } from "../utils/label_groups";
import { labelPagePath } from "./label";
import { useScrollRestoration } from "../utils/use_scroll_restoration";
import StatusMessage from "@shared/status/status";

const AddMenu = () => {
	const { MenuItem, Menu } = Spicetify.ReactComponent;
	const { SVGIcons } = Spicetify;

	const addAlbum = () => {
		const onSave = (value: string) => {
			Spicetify.Platform.LibraryAPI.add({ uris: [value] });
		};

		Spicetify.PopupModal.display({
			title: "Add Album",
			// @ts-ignore
			content: <TextInputDialog def={""} placeholder="Album URI" onSave={onSave} />,
		});
	};

	return (
		<Menu>
			<MenuItem onClick={addAlbum} leadingIcon={<LeadingIcon path={SVGIcons.album} />}>
				Add Album
			</MenuItem>
		</Menu>
	);
};

const limit = 200;
const NAME_SORT = "0";

const sortOptions = [
	{ id: NAME_SORT, name: "Name" },
	{ id: "1", name: "Date Added" },
	{ id: "2", name: "Artist Name" },
	{ id: "6", name: "Recents" },
	{ id: RELEASE_DATE_SORT, name: "Release Date" },
];

const filterOptions = [
	{ id: "0", name: "All" },
	{ id: "1", name: "Albums" },
	{ id: "2", name: "Local Albums" },
];

const groupOptions: { id: GroupPeriod; name: string }[] = [
	{ id: "none", name: "No Grouping" },
	{ id: "month", name: "By Month" },
	{ id: "quarter", name: "By Quarter" },
	{ id: "year", name: "By Year" },
	{ id: "decade", name: "By Decade" },
];

const nameGroupOptions = [
	{ id: "none", name: "No Grouping" },
	{ id: "label", name: "By Label" },
];

function isValidAlbum(album: AlbumItem) {
	const primaryArtist = album.artists?.[0];
	return album.name && album.uri && primaryArtist?.name && primaryArtist?.uri;
}

/** Newest release first (oldest first when reversed); albums without a date go last. */
function sortByReleaseDate(items: AlbumItem[], details: Map<string, AlbumDetails>, reversed: boolean) {
	return [...items].sort((a, b) => {
		const dateA = details.get(a.uri)?.releaseDate;
		const dateB = details.get(b.uri)?.releaseDate;
		if (!dateA && !dateB) return 0;
		if (!dateA) return 1;
		if (!dateB) return -1;
		const diff = dateB.getTime() - dateA.getTime();
		return reversed ? -diff : diff;
	});
}

const AlbumsPage = ({ configWrapper }: { configWrapper: ConfigWrapper }) => {
	const [sortDropdown, sortOption, isReversed] = useSortDropdownMenu(sortOptions, "library:albums");
	const [filterDropdown, filterOption] = useDropdownMenu(filterOptions);
	const [groupDropdown, groupOption] = useDropdownMenu(groupOptions, "library:albums-grouping", "month");
	const [nameGroupDropdown, nameGroupOption] = useDropdownMenu(nameGroupOptions, "library:albums-name-grouping");
	const isReleaseSort = sortOption.id === RELEASE_DATE_SORT;
	const isNameSort = sortOption.id === NAME_SORT;
	const isLabelGrouping = isNameSort && nameGroupOption.id === "label";
	const canGroupByDate = isReleaseSort || sortOption.id === DATE_ADDED_SORT || sortOption.id === RECENTS_SORT;
	// Release date order and label groups need details for every album, so the
	// whole library is loaded up front instead of page by page.
	const loadsAllAlbums = isReleaseSort || isLabelGrouping;
	const [textFilter, setTextFilter] = React.useState("");
	const [detailsProgress, setDetailsProgress] = React.useState({ done: 0, total: 0 });

	const fetchAllAlbumsWithDetails = async () => {
		const items: AlbumItem[] = [];
		for (let offset = 0; ; offset += limit) {
			const res = (await Spicetify.Platform.LibraryAPI.getContents({
				filters: ["0"],
				sortOrder: isReleaseSort ? DATE_ADDED_SORT : sortOption.id,
				sortDirection: !isReleaseSort && isReversed ? "reverse" : undefined,
				textFilter,
				offset,
				limit,
			})) as GetContentsResponse<AlbumItem>;
			items.push(...res.items);
			if (res.items.length === 0 || offset + limit >= res.totalLength) break;
		}

		const uris = items.map((item) => item.uri).filter((uri) => uri?.startsWith("spotify:album:"));
		const details = await getAlbumDetails(uris, (done, total) => setDetailsProgress({ done, total }));
		return { items, details };
	};

	const fetchAlbums = async ({ pageParam }: { pageParam: number }) => {
		const res = (await Spicetify.Platform.LibraryAPI.getContents({
			filters: ["0"],
			sortOrder: sortOption.id,
			textFilter,
			sortDirection: isReversed ? "reverse" : undefined,
			offset: pageParam,
			limit,
		})) as GetContentsResponse<AlbumItem>;
		return res;
	};

	const fetchLocalAlbums = async () => {
		const localAlbums = await CollectionsWrapper.getLocalAlbums();
		let albums = localAlbums.values().toArray() as AlbumItem[];

		if (textFilter) {
			const regex = new RegExp(`\\b${textFilter}`, "i");
			albums = albums.filter((album) => {
				return regex.test(album.name) || album.artists.some((artist) => regex.test(artist.name));
			});
		}

		return albums;
	};

	const { data, status, error, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
		queryKey: ["library:albums", sortOption.id, isReversed, textFilter],
		queryFn: fetchAlbums,
		initialPageParam: 0,
		getNextPageParam: (lastPage) => {
			const current = lastPage.offset + limit;
			if (lastPage.totalLength > current) return current;
		},
		enabled: !loadsAllAlbums,
	});

	const {
		data: allData,
		status: allStatus,
		error: allError,
		refetch: refetchAll,
	} = useQuery({
		// release date order is applied client-side, so reversing it doesn't need a reload
		queryKey: ["library:albums:all", isReleaseSort ? RELEASE_DATE_SORT : sortOption.id, !isReleaseSort && isReversed, textFilter],
		queryFn: fetchAllAlbumsWithDetails,
		enabled: loadsAllAlbums,
	});

	const {
		data: localData,
		status: localStatus,
		error: localError,
	} = useQuery({
		queryKey: ["library:localAlbums", textFilter],
		queryFn: fetchLocalAlbums,
		enabled: configWrapper.config.localAlbums,
	});

	useEffect(() => {
		const update = (e: UpdateEvent) => {
			if (e.data.list !== "albums") return;
			if (loadsAllAlbums) refetchAll();
			else refetch();
		};
		Spicetify.Platform.LibraryAPI.getEvents()._emitter.addListener("update", update, {});
		return () => {
			Spicetify.Platform.LibraryAPI.getEvents()._emitter.removeListener("update", update);
		};
	}, [refetch, refetchAll, loadsAllAlbums]);

	// keep the scroll position when coming back from a label or album page
	const grouping = canGroupByDate ? groupOption.id : isNameSort ? nameGroupOption.id : "none";
	useScrollRestoration(
		["albums", sortOption.id, isReversed, grouping, filterOption.id, textFilter].join(":"),
		"/library/Albums",
		(loadsAllAlbums ? allStatus : status) === "success",
	);

	const Status = loadsAllAlbums ? useStatus(allStatus, allError) : useStatus(status, error);
	const LocalStatus = configWrapper.config.localAlbums && useStatus(localStatus, localError);
	const EmptyStatus = useStatus("error", new Error("No albums found")) as React.ReactElement;

	const props = {
		lhs: ["Albums"],
		rhs: [
			<AddButton Menu={<AddMenu />} />,
			filterDropdown,
			sortDropdown,
			// date grouping for date-based sort orders, label grouping for Name
			canGroupByDate ? groupDropdown : null,
			isNameSort ? nameGroupDropdown : null,
			<SearchBar setSearch={setTextFilter} placeholder="Albums" />,
			<SettingsButton configWrapper={configWrapper} />,
		],
	};

	if (loadsAllAlbums && allStatus === "pending" && detailsProgress.total > detailsProgress.done) {
		return (
			<PageContainer {...props}>
				<StatusMessage
					icon="library"
					heading="Loading album details"
					subheading={`${detailsProgress.done} of ${detailsProgress.total} albums. This only takes long the first time.`}
				/>
			</PageContainer>
		);
	}
	if (Status) return <PageContainer {...props}>{Status}</PageContainer>;
	if (LocalStatus) return <PageContainer {...props}>{LocalStatus}</PageContainer>;

	const details = loadsAllAlbums ? allData?.details : undefined;

	let albums: AlbumItem[] = [];
	if (filterOption.id !== "2") {
		if (loadsAllAlbums) {
			const { items } = allData as NonNullable<typeof allData>;
			albums = isReleaseSort && details ? sortByReleaseDate(items, details, isReversed) : items;
		} else {
			albums = (data as NonNullable<typeof data>).pages.flatMap((page) => page.items);
		}
	}
	if (localData?.length && filterOption.id !== "1") {
		// local albums have no release date, so they go after the sorted Spotify albums
		albums = isReleaseSort
			? albums.concat(localData)
			: albums.concat(localData).sort(collectionSort(sortOption.id, isReversed));
	}

	if (albums.length === 0) return <PageContainer {...props}>{EmptyStatus}</PageContainer>;

	const validAlbums = albums.filter(isValidAlbum);

	const renderCards = (items: AlbumItem[]) =>
		items.map((item) => (
			<SpotifyCard
				key={item.uri}
				type={item.type || "localalbum"}
				uri={item.uri}
				header={item.name}
				subheader={item.artists[0].name}
				imageUrl={item.images?.[0]?.url}
				artistUri={item.artists[0].uri}
				badge={item.pinned ? <PinIcon /> : undefined}
			/>
		));

	const loadMoreCard =
		!loadsAllAlbums && hasNextPage ? <LoadMoreCard key="load-more" callback={fetchNextPage} /> : null;

	const getDate = (item: AlbumItem) =>
		isReleaseSort ? details?.get(item.uri)?.releaseDate ?? null : getGroupDate(item, sortOption.id);

	let groups = null;
	if (canGroupByDate) {
		groups = groupByPeriod(validAlbums, getDate, groupOption.id as GroupPeriod);
	} else if (isLabelGrouping && details) {
		groups = groupByLabel(validAlbums, (item) => details.get(item.uri)?.label ?? null, isReversed);
	}

	if (groups) {
		return (
			<PageContainer {...props}>
				{groups.map((group, index) => (
					<section className="library-date-group" key={group.key}>
						<h2 className="library-date-group-title">
							{isLabelGrouping && group.key !== "unknown" ? (
								<button
									type="button"
									className="library-group-link"
									title={`Show all releases from ${group.label}`}
									onClick={() => Spicetify.Platform.History.push(labelPagePath(group.label))}
								>
									{group.label}
								</button>
							) : (
								group.label
							)}
						</h2>
						<div className={"main-gridContainer-gridContainer grid"}>
							{renderCards(group.items)}
							{index === groups.length - 1 && loadMoreCard}
						</div>
					</section>
				))}
			</PageContainer>
		);
	}

	return (
		<PageContainer {...props}>
			<div className={"main-gridContainer-gridContainer grid"}>
				{renderCards(validAlbums)}
				{loadMoreCard}
			</div>
		</PageContainer>
	);
};

export default AlbumsPage;
