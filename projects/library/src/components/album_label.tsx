import React from "react";
import { labelPagePath } from "../utils/label_path";

/** Third line on an album card: the record label, linking to the label's page. */
const AlbumLabel = ({ label }: { label: string }) => {
	const { TextComponent } = Spicetify.ReactComponent;

	const openLabel = (event: React.MouseEvent) => {
		// the card itself navigates to the album on click
		event.preventDefault();
		event.stopPropagation();
		Spicetify.Platform.History.push(labelPagePath(label));
	};

	return (
		<TextComponent as="div" variant="mesto" semanticColor="textSubdued" className="library-album-label-line">
			<button type="button" className="library-album-label-link" title={`Show all releases from ${label}`} onClick={openLabel}>
				{label}
			</button>
		</TextComponent>
	);
};

export default AlbumLabel;
