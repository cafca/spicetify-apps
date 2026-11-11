/** Route of the Library app's page listing all releases of a record label. */
export function labelPagePath(label: string) {
	return `/library/Label/${encodeURIComponent(label)}`;
}
