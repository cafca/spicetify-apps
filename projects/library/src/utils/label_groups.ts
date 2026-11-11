import type { DateGroup } from "./date_groups";

/**
 * Groups items by record label. Groups are ordered alphabetically by label
 * (Z to A when reversed), with albums without a label last; items keep their
 * incoming order within a group.
 */
export function groupByLabel<T>(
	items: T[],
	getLabel: (item: T) => string | null,
	reversed: boolean,
): DateGroup<T>[] | null {
	const groupsByKey = new Map<string, DateGroup<T>>();
	let hasLabels = false;

	for (const item of items) {
		const label = getLabel(item);
		if (label) hasLabels = true;

		const key = label ? label.toLocaleLowerCase() : "";
		let group = groupsByKey.get(key);
		if (!group) {
			group = { key: key || "unknown", label: label || "Unknown label", items: [] };
			groupsByKey.set(key, group);
		}
		group.items.push(item);
	}

	if (!hasLabels) return null;

	const unknown = groupsByKey.get("");
	groupsByKey.delete("");
	const groups = [...groupsByKey.values()].sort((a, b) => a.label.localeCompare(b.label));
	if (reversed) groups.reverse();
	if (unknown) groups.push(unknown);
	return groups;
}
