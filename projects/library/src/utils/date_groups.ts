import type { Item } from "../types/platform";

export type GroupPeriod = "none" | "month" | "quarter" | "year" | "decade";

export interface DateGroup<T> {
	key: string;
	label: string;
	items: T[];
}

/** Sort order ids from LibraryAPI.getContents that can be grouped by date. */
export const DATE_ADDED_SORT = "1";
export const RECENTS_SORT = "6";
/** Client-side sort; LibraryAPI.getContents has no release date order. */
export const RELEASE_DATE_SORT = "release-date";

function toDate(value: unknown): Date | null {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value as string | number);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The date an item is grouped under for a given sort order.
 * Recents mirrors Spotify's own ordering: whichever is later of when the item
 * was saved and when it was last played.
 */
export function getGroupDate(item: Item, sortOrderId: string): Date | null {
	const addedAt = toDate(item.addedAt);
	if (sortOrderId === DATE_ADDED_SORT) return addedAt;

	const lastPlayedAt = toDate(item.lastPlayedAt);
	if (!addedAt) return lastPlayedAt;
	if (!lastPlayedAt) return addedAt;
	return lastPlayedAt > addedAt ? lastPlayedAt : addedAt;
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

function periodOf(date: Date, period: Exclude<GroupPeriod, "none">): { key: string; label: string } {
	const year = date.getFullYear();
	switch (period) {
		case "month":
			return { key: `${year}-${date.getMonth()}`, label: monthFormatter.format(date) };
		case "quarter": {
			const quarter = Math.floor(date.getMonth() / 3) + 1;
			return { key: `${year}-q${quarter}`, label: `Q${quarter} ${year}` };
		}
		case "year":
			return { key: `${year}`, label: `${year}` };
		case "decade": {
			const decade = Math.floor(year / 10) * 10;
			return { key: `${decade}s`, label: `${decade}s` };
		}
	}
}

/**
 * Groups items into calendar periods, keeping the incoming order: groups appear
 * in the order their first item does, and items keep their order within a group.
 * Returns null when grouping is off or no item has a usable date, so callers can
 * fall back to an ungrouped grid.
 */
export function groupByPeriod<T>(
	items: T[],
	getDate: (item: T) => Date | null,
	period: GroupPeriod,
): DateGroup<T>[] | null {
	if (period === "none") return null;

	const groups: DateGroup<T>[] = [];
	const groupsByKey = new Map<string, DateGroup<T>>();
	let hasDates = false;

	for (const item of items) {
		const date = getDate(item);
		if (date) hasDates = true;

		const { key, label } = date ? periodOf(date, period) : { key: "unknown", label: "Unknown date" };
		let group = groupsByKey.get(key);
		if (!group) {
			group = { key, label, items: [] };
			groupsByKey.set(key, group);
			groups.push(group);
		}
		group.items.push(item);
	}

	return hasDates ? groups : null;
}
