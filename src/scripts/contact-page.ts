import { setupContactMessage } from "~/scripts/contact-message";
import { setupSwitchboard } from "~/scripts/switchboard";

/** /contact: the switchboard, with its message line opening the form on the same page. */
export function setupContactPage() {
	const root = document.querySelector<HTMLElement>("[data-switchboard]");
	const panel = document.querySelector<HTMLElement>("[data-message-panel]");

	if (!root || !panel) return;
	const message = setupContactMessage(panel);
	const board = setupSwitchboard(root, { onMessage: message.open });

	function reveal() {
		if (location.hash !== "#message") return;

		if (board) board.connect("message");
		else message.open();
	}

	reveal();
	window.addEventListener("hashchange", reveal);
}
