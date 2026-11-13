export function setupAudioServicesLinks() {
	function openService() {
		const target = document.getElementById(location.hash.slice(1));

		if (target instanceof HTMLDetailsElement) target.open = true;
	}

	openService();
	window.addEventListener("hashchange", openService);
}
