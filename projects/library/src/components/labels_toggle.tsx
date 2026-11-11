import React from "react";

const STORAGE_KEY = "library:albums-show-labels";

/** Header toggle that shows or hides the record label line on album cards; remembered between sessions. */
export function useLabelsToggle(): [React.ReactElement, boolean] {
	const [showLabels, setShowLabels] = React.useState(() => Spicetify.LocalStorage.get(STORAGE_KEY) === "true");

	const toggle = () => {
		setShowLabels((previous) => {
			Spicetify.LocalStorage.set(STORAGE_KEY, String(!previous));
			return !previous;
		});
	};

	const button = (
		<button
			type="button"
			className={`x-sortBox-sortDropdown library-toggle-button${showLabels ? " is-active" : ""}`}
			aria-pressed={showLabels}
			title={showLabels ? "Hide record labels" : "Show record labels"}
			onClick={toggle}
		>
			<span>Labels</span>
		</button>
	);

	return [button, showLabels];
}
