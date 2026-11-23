import { setupBriefAutocomplete } from "./brief-autocomplete";
import { setupBriefBoard, type BriefBoardOptions } from "./brief-board";
import type { BriefBoardHandle, Where } from "./brief-board-core";
import {
	LANES,
	LANE_STEPS,
	type Lane,
	boardAnswerKeys,
	laneLabels,
	originLabels,
} from "../lib/brief-board";
import { setupSuggestionPass } from "./brief-suggestion-pass";
import {
	clientSoftwareLabels,
	softwareBriefKickers,
	softwarePaths,
	timingLabels,
	updateLabels,
	validateSoftwareInquiry,
	type SoftwarePath,
} from "../lib/software-inquiry";
import { ownLabel } from "../lib/type-guards";
import { greetingName, setupFormSubmission } from "./form-submission";
import { openMessages } from "./form-messages";

// Each path's screens in order, by data-step, without the outline. Website adds two screens after its first question.
const plans = {
	website: [0, 1, 7, 8, 3, 4, 5, 6],
	webapp: [0, 1, 2, 3, 4, 5, 6],
	workflow: [0, 1, 2, 3, 4, 5, 6],
} as const;

/**
 * A path's screens in order, by data-step. With the outline, its three lane screens follow the written questions, whatever
 * the cards are, so the dots never change because an answer changed.
 */
export function briefPlan(
	path: SoftwarePath,
	outline: boolean,
): readonly number[] {
	const base = plans[path];

	if (!outline) return base;
	// The written questions are data-steps 1 and, for the web app and workflow, 2.
	const after = briefQuestions[path].length + 1;

	return [...base.slice(0, after), ...LANE_STEPS, ...base.slice(after)];
}

/**
 * The screen a saved draft was left on, as this page numbers it. A draft saved by the page with four lane screens (it has
 * no `outlineScreens`) numbered them 9 to 12, the purpose screen first: that screen is gone, so its draft opens the first
 * written question, and the other three move up one.
 */
const OUTLINE_SCREENS = 3;

export const draftSection = (section: number, outlineScreens: number) =>
	outlineScreens === OUTLINE_SCREENS || section < 9
		? section
		: section === 9
			? 1
			: section - 1;

const laneOfSection = (section: number): Lane | null =>
	LANES[LANE_STEPS.findIndex((step) => step === section)] ?? null;

/** What a screen is to the outline: one of its lane screens, a written question, or neither. */
const whereIs = (section: number): Where =>
	laneOfSection(section) ??
	(section === 1 || section === 2 ? "written" : "other");

const pathFields = {
	website: ["purpose", "currentUrl", "existing", "updates"],
	webapp: ["appGoal", "firstVersion"],
	workflow: ["today", "firstResult"],
} as const;

type BriefQuestion = {
	key: string;
	title: string;
	hint: string;
	/** One example answer, shown in the empty box. */
	placeholder: string;
	max: number;
	/** Further example answers from other situations, shown under the footnote by its "See example answers" toggle. */
	examples: readonly string[];
};

// Each path's written questions, in the order of data-step 1 and 2. Examples are fictional answers a visitor might give.
export const briefQuestions: Record<SoftwarePath, readonly BriefQuestion[]> = {
	website: [
		{
			key: "purpose",
			title: "What’s the website for?",
			hint: "Who it’s for, and what you want visitors to do when they get there.",
			placeholder:
				"A site for my pottery studio. People should see upcoming classes and sign up without messaging me first.",
			max: 2000,
			examples: [
				"I’m a wedding photographer. Couples should see my work and packages, then ask whether I’m free on their date.",
				"Our food pantry needs a site where volunteers can sign up for a shift and neighbors can check opening hours.",
				"A home for my band: new music, show dates and a way to join the mailing list.",
			],
		},
	],
	webapp: [
		{
			key: "appGoal",
			title: "What should the app let people do?",
			hint: "Who it’s for, and the one thing they’d come back for.",
			placeholder:
				"Let my students book and pay for lessons without emailing me.",
			max: 1000,
			examples: [
				"Give our volunteers one place to see their shifts and swap them with each other.",
				"Let customers check on a repair without calling the shop.",
				"Help members of our running club find a group run at their pace and sign up.",
			],
		},
		{
			key: "firstVersion",
			title: "Have a first version in mind?",
			hint: "If you have a hunch, or a spreadsheet or prototype it should replace. Otherwise I’ll propose one.",
			placeholder:
				"Students see my open times and book one. Payment can wait for a later version.",
			max: 1000,
			examples: [
				"We track shifts in a spreadsheet. A first version could show each volunteer their own shifts on a phone.",
				"A page where a customer types their order number and sees where the repair is.",
				"No real idea yet. I’d like to hear what you would build first.",
			],
		},
	],
	workflow: [
		{
			key: "today",
			title: "What happens today?",
			hint: "Who does it, what’s slow or error-prone, and what it costs you.",
			placeholder:
				"We track new clients in a shared spreadsheet. Three of us update it, and follow-ups slip through the cracks.",
			max: 2000,
			examples: [
				"Every Friday I copy orders from our online shop into the accounting tool by hand. It takes about two hours, and typos turn into refunds.",
				"New hires are set up from a checklist in a shared document. Steps get missed, and nobody knows who did what.",
				"Customers email photos to get a quote. I retype the details into a spreadsheet before I can price the job.",
			],
		},
		{
			key: "firstResult",
			title: "Have a first result in mind?",
			hint: "If you have a hunch. Otherwise I’ll propose one.",
			placeholder:
				"Each Monday, a list of clients whose follow-up is overdue, sent to the person who owns each one.",
			max: 2000,
			examples: [
				"Orders reach the accounting tool on their own, and I only check the ones that don’t match.",
				"One page that shows which setup steps are done for each new hire.",
				"Not sure yet. Something small we could try for a few weeks.",
			],
		},
	],
};

// The success body of /api/software-inquiry, as renderSoftwareReceipt reads it.
type SoftwareReceiptResult = { brief?: unknown; clientCopyStatus?: unknown };

function isSoftwarePath(value: unknown): value is SoftwarePath {
	return typeof value === "string" && Object.hasOwn(softwarePaths, value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

// The API sends back the brief it built from the form. softwareBrief() in src/lib/software-inquiry.ts returns Record<string, string>, but this only rules out non-objects and arrays; the receipt reads the fields it shows with optional chaining.
function isBriefRecord(value: unknown): value is Record<string, string> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// What a saved draft's answers can hold. This script writes strings only, but the object is read back from localStorage, so every value is read through isString (or compared with ===) before use.
type DraftAnswers = Partial<Record<string, string | number | boolean | null>>;

function isDraftAnswers(value: unknown): value is DraftAnswers {
	return typeof value === "object" && value !== null;
}

export function renderSoftwareReceipt(
	result: SoftwareReceiptResult,
	path?: string,
) {
	const brief = isBriefRecord(result.brief) ? result.brief : {};

	const firstName = greetingName(brief.name);
	document.querySelector<HTMLElement>("[data-receipt-thanks]")!.textContent =
		`Thanks, ${firstName}. I’ll read it myself and reply within two business days.`;
	document.querySelector<HTMLElement>("[data-intake-progress]")!.hidden = true;
	const kicker = document.querySelector<HTMLElement>("[data-brief-kicker]");

	if (kicker) kicker.hidden = true;
	const sent = result.clientCopyStatus === "sent";
	const uncertain = result.clientCopyStatus === "uncertain";
	document.querySelector<HTMLElement>("[data-copy-status]")!.textContent = sent
		? `A copy is on its way to ${brief.email}.`
		: uncertain
			? "Your copy should arrive shortly."
			: "I couldn’t send your copy just now, but your brief is saved and I’ll still reply.";
	document.querySelector<HTMLElement>("[data-copy-icon]")!.hidden =
		!sent && !uncertain;
	const note = document.querySelector<HTMLElement>("[data-copy-note]")!;
	note.hidden = !sent && !uncertain;
	note.textContent = uncertain
		? "If it doesn’t, your brief is still saved and I’ll still reply."
		: "It has everything you wrote, so you don’t need to save this page.";

	if (path === "website")
		document.querySelector<HTMLElement>(
			"[data-receipt-first-step]",
		)!.textContent =
			"I’ll look at what you have and reply with a fixed-price first milestone, or a question or two.";
}

export function setupSoftwareInquiry(
	form: HTMLFormElement,
	startSuggestionPass: typeof setupSuggestionPass,
	startBoard: (
		options: BriefBoardOptions,
	) => BriefBoardHandle = setupBriefBoard,
) {
	const steps = [...form.querySelectorAll<HTMLElement>("[data-step]")];
	const next = form.querySelector<HTMLButtonElement>("[data-next]")!;
	const back = form.querySelector<HTMLButtonElement>("[data-back]")!;
	const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
	const status = form.querySelector<HTMLElement>("[data-form-status]")!;
	const storageKey = "software-brief-draft";
	const sentKey = "software-brief-sent";
	const requestedPath = new FormData(form).get("path");

	// The path the link named, from the server. A browser that restores form state on reload can check
	// a radio the link did not name, so the checked radio alone cannot tell a path link from a reload.
	const linkedPath = form.dataset.linkedPath;
	const answers: Record<string, string> = {};
	let sentElsewhere = false;

	const sentNotice =
		"This brief was already sent from another tab. Your changes here will be sent as a new brief.";

	let step = isSoftwarePath(linkedPath) ? 1 : 0,
		// The data-step a saved draft was left on, when there is one to go back to.
		resumeAt: number | undefined,
		submissionId = crypto.randomUUID();

	const path = (): SoftwarePath => {
		const value = new FormData(form).get("path");

		return isSoftwarePath(value) ? value : "workflow";
	};

	// Set once the outline is set up, below: the plan depends on whether the visitor skipped it.
	let briefBoard: BriefBoardHandle | null = null;

	const plan = (): readonly number[] =>
		briefPlan(path(), briefBoard !== null && !briefBoard.skipped());

	const last = () => plan().length - 1;

	const fields = () => [
		"path",
		...pathFields[path()],
		"timing",
		"timingDate",
		"budgetNote",
		"name",
		"email",
		"company",
	];

	const payload = (trim = true) =>
		Object.fromEntries(
			fields().map((key) => [
				key,
				trim
					? String(new FormData(form).get(key) ?? "").trim()
					: String(new FormData(form).get(key) ?? ""),
			]),
		);

	// The fields each data-step asks for, for validation and the review list.
	const sectionFields = (section: number): string[] =>
		[
			["path"],
			[pathFields[path()][0]],
			[pathFields[path()][1]],
			["timing", "timingDate"],
			["budgetNote"],
			["name", "email", "company"],
			[],
			["currentUrl", "existing"],
			["updates"],
		][section] ?? [];

	function noticeSentDraft() {
		// Keep the identity stable until the in-flight response has been handled.
		if (form.getAttribute("aria-busy") === "true") return false;

		try {
			if (localStorage.getItem(sentKey) !== submissionId) return false;
			submissionId = crypto.randomUUID();
			sentElsewhere = true;
			status.textContent = sentNotice;

			return true;
		} catch {
			return false;
		}
	}

	function save() {
		noticeSentDraft();
		steps.slice(1, 3).forEach((section) => {
			const box = section.querySelector<HTMLTextAreaElement>("[data-answer]")!;

			if (box.name) answers[box.name] = box.value;
		});

		// Website answers stay saved while another path is selected.
		const kept = Object.fromEntries(
			["currentUrl", "existing", "updates"].map((key) => [
				key,
				String(new FormData(form).get(key) ?? ""),
			]),
		);

		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify({
					answers: { ...payload(false), ...kept, ...answers },
					step,
					// The screen by its data-step: the plan changes when the outline is skipped or added back.
					section: plan()[step],
					outlineScreens: OUTLINE_SCREENS,
					submissionId,
				}),
			);
		} catch {
			/* Keep writing when storage is unavailable. */
		}
	}

	function configureQuestions() {
		const questions = briefQuestions[path()];

		questions.forEach(({ key, title, hint, placeholder, max, examples }, i) => {
			const section = steps[i + 1],
				box = section.querySelector<HTMLTextAreaElement>("[data-answer]")!;

			box.name = key;
			box.maxLength = max;
			box.placeholder = placeholder;
			section.querySelector("h1")!.textContent = title;
			section.querySelector("[data-answer-label]")!.textContent = title;
			section.querySelector("[data-question-hint]")!.textContent = hint;
			// More answers in other situations, read-only, for a visitor who doesn't know what to write. The placeholder holds one more.
			section.querySelector("[data-examples-list]")?.replaceChildren(
				...examples.map((text) => {
					const item = document.createElement("li");
					item.textContent = text;

					return item;
				}),
			);
			const error = section.querySelector<HTMLElement>("[data-form-error]")!;
			error.dataset.formError = key;
			error.textContent = "";
			error.hidden = true;
			// form-submission links an error to its box only when the box is named at setup. Link it now if the error already has an id.
			const described = box.getAttribute("aria-describedby") ?? "";

			if (error.id && !described.split(/\s+/).includes(error.id))
				box.setAttribute(
					"aria-describedby",
					[described, error.id].filter(Boolean).join(" "),
				);
			box.removeAttribute("aria-invalid");
		});
	}

	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");

		if (saved && saved.answers && isDraftAnswers(saved.answers)) {
			const stored = { ...saved.answers };

			// Drafts from before the named paths used one "idea" path, which is now the web app brief. Its idea text is the app goal on any path.
			if (stored.path === "idea") stored.path = "webapp";

			if (isString(stored.idea) && !isString(stored.appGoal))
				stored.appGoal = stored.idea;

			// Every path's written answers, each cut to its question's limit.
			for (const { key, max } of Object.values(briefQuestions).flat()) {
				const value = stored[key];

				if (isString(value)) answers[key] = value.slice(0, max);
			}

			for (const name of ["path", "timing", "updates"])
				form
					.querySelectorAll<HTMLInputElement>(`[name="${name}"]`)
					.forEach(
						(box) =>
							(box.checked =
								box.value ===
								(name === "path" && requestedPath
									? requestedPath
									: stored[name])),
					);
			configureQuestions();

			for (const key of [...fields(), "currentUrl", "existing"]) {
				const control = form.elements.namedItem(key),
					value = stored[key];

				if (
					(control instanceof HTMLInputElement ||
						control instanceof HTMLTextAreaElement) &&
					isString(value)
				)
					control.value = value.slice(
						0,
						control.maxLength > 0 ? control.maxLength : 200,
					);
			}

			// The screen the draft was left on, by its data-step: the plan depends on the saved outline, which is read below. A
			// draft from before the outline had screens saved only an index into the plans without one.
			const storedPath: unknown = stored.path;

			if (
				isSoftwarePath(storedPath) &&
				(!requestedPath || requestedPath === storedPath) &&
				(Number.isInteger(saved.section) ||
					(Number.isInteger(saved.step) && saved.step >= 0))
			)
				resumeAt = Number.isInteger(saved.section)
					? draftSection(
							saved.section,
							Number.isInteger(saved.outlineScreens) ? saved.outlineScreens : 0,
						)
					: // An index past the old plan opens the first written question (data-step 1), like a section the plan no longer has.
						(plans[storedPath][saved.step] ?? 1);

			if (
				isString(saved.submissionId) &&
				/^[a-f0-9-]{36}$/i.test(saved.submissionId)
			)
				submissionId = saved.submissionId;
		}
	} catch {
		/* Ignore unavailable storage and invalid drafts. */
	}

	configureQuestions();

	// Each written question's example answers open under its footnote and stay open through a path switch.
	form
		.querySelectorAll<HTMLButtonElement>("[data-examples-toggle]")
		.forEach((toggle) =>
			toggle.addEventListener("click", () => {
				const list = toggle
					.closest("[data-step]")
					?.querySelector<HTMLElement>("[data-examples-list]");

				if (!list) return;

				const open = list.hidden;
				list.hidden = !open;
				toggle.setAttribute("aria-expanded", String(open));
				toggle.textContent = open
					? "Hide example answers"
					: "See example answers";
			}),
		);

	// One Turnstile pass serves the autocomplete and the outline: the same cookie, sent to the same path.
	const startPass = startSuggestionPass(form);

	const suggestions = setupBriefAutocomplete(
		form,
		() =>
			plan()[step] === 2
				? {
						path: path(),
						[pathFields[path()][0]]: payload()[pathFields[path()][0]],
					}
				: { path: path() },
		() => startPass,
		() => briefBoard?.aiChanged(),
	);

	// The written answers the outline reads: the boxes the autocomplete reads, never the contact details.
	const writtenAnswers = () => {
		const values = payload(false);

		return Object.fromEntries(
			boardAnswerKeys[path()].map((key) => [key, values[key] ?? ""]),
		);
	};

	briefBoard =
		form.dataset.board === "true"
			? startBoard({
					form,
					path,
					answers: writtenAnswers,
					startPass,
					aiEnabled: () => suggestions.isEnabled(),
					onChange: () => {
						if (step === last()) renderSummary();
					},
				})
			: null;

	// Back to the screen the draft was left on, now that the plan is known. One that the plan no longer has (a lane screen
	// of a skipped outline, or an index past the end) opens the first written question.
	if (resumeAt !== undefined) {
		const at = plan().indexOf(resumeAt);

		step = at >= (isSoftwarePath(linkedPath) ? 1 : 0) ? at : 1;
	}

	/** A lane screen's position in the plan; it is only asked while the outline is in the plan. */
	const laneIndex = (lane: Lane) =>
		plan().indexOf(LANE_STEPS[LANES.indexOf(lane)]);

	function renderSummary() {
		const list = form.querySelector<HTMLDListElement>("[data-review]")!;
		list.replaceChildren();
		const values = payload();

		const labels = {
			budgetNote: "Budget (USD)",
			firstResult: "First result",
			firstVersion: "First version",
		};

		for (const [key, value] of Object.entries(values)) {
			if (!value || (key === "timingDate" && values.timing !== "date"))
				continue;

			const index = plan().findIndex((section) =>
				sectionFields(section).includes(key),
			);

			const dt = document.createElement("dt"),
				dd = document.createElement("dd"),
				edit = document.createElement("button");

			dt.textContent =
				ownLabel(labels, key) ?? ownLabel(clientSoftwareLabels, key) ?? "";
			dd.textContent =
				key === "path"
					? (ownLabel(softwarePaths, value) ?? value)
					: key === "timing"
						? (ownLabel(timingLabels, value) ?? value)
						: key === "updates"
							? (ownLabel(updateLabels, value) ?? value)
							: value;
			edit.type = "button";
			edit.textContent = "Edit";
			edit.setAttribute("aria-label", `Edit ${dt.textContent}`);
			edit.addEventListener("click", () => showStep(index));
			dd.appendChild(document.createTextNode(" "));
			dd.appendChild(edit);
			list.appendChild(dt);
			list.appendChild(dd);
		}

		// The outline, as it will be sent: each item with where it came from. Suggestions not kept are not listed.
		const outline = briefBoard?.outline();

		if (outline) {
			const dt = document.createElement("dt"),
				dd = document.createElement("dd"),
				items = document.createElement("ul"),
				edit = document.createElement("button");

			dt.textContent = "Brief outline";
			items.className = "review-outline";
			items.setAttribute("role", "list");

			for (const item of outline) {
				const entry = document.createElement("li"),
					origin = document.createElement("span");

				origin.className = "review-outline-origin";
				// An answered question reads as it did on its lane screen.
				origin.textContent = ` · ${item.answer && item.origin === "kept" ? "You answered" : originLabels[item.origin]}`;
				// Each item with its lane, as the outline is grouped on its screens ("Pages: Shows").
				entry.appendChild(
					document.createTextNode(
						`${laneLabels[path()][item.lane]}: ${item.text}`,
					),
				);
				entry.appendChild(origin);

				if (item.answer)
					entry.appendChild(
						document.createTextNode(` · Your answer: ${item.answer}`),
					);
				items.appendChild(entry);
			}

			edit.type = "button";
			edit.textContent = "Edit";
			edit.setAttribute("aria-label", "Edit Brief outline");
			edit.addEventListener("click", () => showStep(laneIndex(LANES[0])));
			dd.appendChild(items);
			dd.appendChild(edit);
			list.appendChild(dt);
			list.appendChild(dd);
		}

		// Cards read from the answers that their lane has not shown the visitor: they go with the brief unless removed.
		const unseen = briefBoard?.unseen() ?? [];

		if (unseen.length) {
			const dt = document.createElement("dt"),
				dd = document.createElement("dd"),
				items = document.createElement("ul");

			dt.textContent = "New since you last looked";
			items.className = "review-outline";
			items.setAttribute("role", "list");

			for (const card of unseen) {
				const entry = document.createElement("li"),
					edit = document.createElement("button"),
					label = `${laneLabels[path()][card.lane]}: ${card.text}`;

				entry.appendChild(document.createTextNode(`${label} `));
				edit.type = "button";
				edit.textContent = "Edit";
				edit.setAttribute("aria-label", `Edit ${label}`);
				edit.addEventListener("click", () => showStep(laneIndex(card.lane)));
				entry.appendChild(edit);
				items.appendChild(entry);
			}

			dd.appendChild(items);
			list.appendChild(dt);
			list.appendChild(dd);
		}

		// After a skip, the outline can come back from here.
		const addBack = form.querySelector<HTMLElement>("[data-outline-add-back]");

		if (addBack) addBack.hidden = !briefBoard?.skipped();
	}

	function showStep(index: number, focus = true) {
		suggestions.clear();
		step = index;
		const section = plan()[index];
		steps.forEach((node, i) => (node.hidden = i !== section));

		if (section === 1 || section === 2) suggestions.start();
		// Leaving a lane screen, by any way out, applies what the lane held back (see leaveLane).
		briefBoard?.screen(whereIs(section));
		document
			.querySelectorAll<HTMLElement>(".intake-progress li")
			.forEach((item, i) => {
				item.hidden = i >= plan().length;

				if (i === index) item.setAttribute("aria-current", "step");
				else item.removeAttribute("aria-current");
				item.querySelector<HTMLElement>(".sr-only")!.textContent =
					`Question ${i + 1} of ${plan().length}`;
			});
		const kicker = document.querySelector<HTMLElement>("[data-brief-kicker]");

		if (kicker)
			kicker.textContent =
				index === 0 ? "Project brief" : softwareBriefKickers[path()];
		const timingHint = form.querySelector<HTMLElement>("[data-timing-hint]");

		if (timingHint) timingHint.hidden = path() !== "website";
		form.querySelector<HTMLElement>("[data-send-reassurance]")!.hidden =
			index !== last();
		next.hidden = index === last();
		submit.hidden = index !== last();
		back.hidden = index === 0;
		status.textContent = sentElsewhere ? sentNotice : "";

		if (index === last()) renderSummary();

		if (focus) steps[section].querySelector<HTMLElement>("h1")!.focus();
		save();
	}

	function continueStep() {
		const input = payload();

		const result = validateSoftwareInquiry({
			...input,
			turnstileToken: "pending",
			submissionId,
		});

		const errors = result.ok ? {} : result.errors;
		const keys = sectionFields(plan()[step]);

		if (step === 0 && !new FormData(form).get("path"))
			errors.path = "Choose a starting point.";

		const first = openMessages(form, step === last() ? submit : next, () => {
			let first: HTMLElement | undefined;

			for (const key of keys) {
				const control = [...form.elements].find(
					(node): node is HTMLInputElement | HTMLTextAreaElement =>
						(node instanceof HTMLInputElement ||
							node instanceof HTMLTextAreaElement) &&
						node.getAttribute("name") === key,
				);

				const message =
					errors[key] ||
					(control && !control.checkValidity()
						? "Please check this answer."
						: "");

				const error = form.querySelector<HTMLElement>(
					`[data-form-error="${key}"]`,
				);

				if (error) {
					error.textContent = message;
					error.hidden = !message;
				}

				if (control) {
					if (message) {
						control.setAttribute("aria-invalid", "true");
						first ??= control;
					} else control.removeAttribute("aria-invalid");
				}
			}

			if (first) {
				status.textContent = "Please check the highlighted fields.";
				first.focus();
			}

			return first;
		});

		if (first) return;

		if (step < last()) showStep(step + 1);
	}

	form.addEventListener("input", save);
	form.addEventListener("input", (event) => {
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.hasAttribute("data-answer")
		)
			briefBoard?.answersChanged();
	});
	// Only a pointer choice moves on by itself. Arrow keys step through the radio group, so keyboard and screen-reader users
	// reach every starting point and continue with Next, as they do after any other answer.
	let pointerChoice = false;
	form.addEventListener("pointerdown", () => {
		pointerChoice = true;
	});
	form.addEventListener("keydown", () => {
		pointerChoice = false;
	});
	form.addEventListener("change", (event) => {
		const control =
			event.target instanceof HTMLInputElement ? event.target : null;

		if (control?.name === "path") {
			steps.slice(1, 3).forEach((section) => {
				const box = section.querySelector<HTMLTextAreaElement>("textarea")!;

				if (box.name) answers[box.name] = box.value;
			});
			configureQuestions();
			steps.slice(1, 3).forEach((section) => {
				const box = section.querySelector<HTMLTextAreaElement>("textarea")!;

				if (box.name) box.value = answers[box.name] ?? "";
			});
			briefBoard?.pathChanged();

			if (pointerChoice) continueStep();
			else {
				const error = form.querySelector<HTMLElement>(
					'[data-form-error="path"]',
				)!;

				error.textContent = "";
				error.hidden = true;
				form
					.querySelectorAll<HTMLInputElement>('[name="path"]')
					.forEach((box) => box.removeAttribute("aria-invalid"));
				showStep(step, false);
			}

			pointerChoice = false;
		}

		if (control?.name === "timing") {
			form.querySelector<HTMLElement>("[data-date-field]")!.hidden =
				control.value !== "date";

			if (control.value !== "date") {
				// src/pages/software/start.astro renders exactly one timingDate input; a missing one throws here, as it did before.
				const date = form.elements.namedItem("timingDate");

				if (!(date instanceof HTMLInputElement))
					throw new TypeError("The timingDate input is missing.");
				date.value = "";
				date.removeAttribute("aria-invalid");

				const error = form.querySelector<HTMLElement>(
					'[data-form-error="timingDate"]',
				)!;

				error.textContent = "";
				error.hidden = true;
				status.textContent = sentElsewhere ? sentNotice : "";
			}
		}

		save();
	});
	form.querySelector<HTMLElement>("[data-date-field]")!.hidden =
		payload().timing !== "date";
	next.addEventListener("click", continueStep);
	back.addEventListener("click", () => showStep(Math.max(0, step - 1)));
	form.querySelectorAll<HTMLButtonElement>("[data-skip]").forEach((button) =>
		button.addEventListener("click", () => {
			steps[plan()[step]]
				.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
					"input, textarea",
				)
				.forEach((control) => (control.value = ""));
			continueStep();
		}),
	);
	// "Skip these, no AI outline": the lane screens leave the plan and the visitor goes on to the step after them.
	form
		.querySelectorAll<HTMLButtonElement>("[data-board-skip]")
		.forEach((button) =>
			button.addEventListener("click", () => {
				const after = plan()[laneIndex(LANES[LANES.length - 1]) + 1];

				briefBoard?.skip();
				showStep(plan().indexOf(after));
			}),
		);
	// "Add the outline back" (on the review, after a skip): the screens and the cards return, and the visitor stays on the review.
	form
		.querySelector<HTMLButtonElement>("[data-outline-add-back]")
		?.addEventListener("click", () => {
			briefBoard?.addBack();
			showStep(plan().indexOf(6));
		});
	form.addEventListener("keydown", (event) => {
		if (
			(event.ctrlKey || event.metaKey) &&
			event.key === "Enter" &&
			step < last()
		) {
			event.preventDefault();
			continueStep();
		}
	});
	window.addEventListener("storage", (event) => {
		if (event.key === sentKey) {
			if (noticeSentDraft()) save();
		}
	});
	form.addEventListener("submit", (event) => {
		if (noticeSentDraft()) {
			event.preventDefault();
			event.stopImmediatePropagation();
			save();

			return;
		}

		if (step !== last()) {
			event.preventDefault();
			event.stopImmediatePropagation();
			continueStep();
		}
	});

	const disabledControls = new Map<
		HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement,
		boolean
	>();

	setupFormSubmission({
		form,
		endpoint: "/api/software-inquiry",
		success: document.getElementById("software-success")!,
		payload: () => {
			const outline = briefBoard?.outline();

			// The outline is sent only when the board holds something to send, so a brief without one is sent as before.
			return outline
				? { ...payload(), submissionId, outline }
				: { ...payload(), submissionId };
		},
		onSendingChange: (sending) => {
			if (sending) {
				form
					.querySelectorAll<
						HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
					>("input, textarea, button")
					.forEach((control) => {
						if (control === submit) return;
						disabledControls.set(control, control.disabled);
						control.disabled = true;
					});
			} else {
				disabledControls.forEach((disabled, control) => {
					control.disabled = disabled;
				});
				disabledControls.clear();
			}
		},
		onSuccess: (result: SoftwareReceiptResult) => {
			suggestions.clear();
			briefBoard?.screen("other");
			briefBoard?.sent();

			try {
				localStorage.setItem(sentKey, submissionId);
				const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");

				if (saved?.submissionId === submissionId)
					localStorage.removeItem(storageKey);
			} catch {
				/* Storage is optional. */
			}

			renderSoftwareReceipt(result, path());
		},
		onConflict: () => {
			submissionId = crypto.randomUUID();
			save();
		},
	});

	const observer = new MutationObserver((records) => {
		const target = records
			.flatMap((record) =>
				record.target instanceof HTMLElement ? [record.target] : [],
			)
			.find(
				(node) =>
					node.getAttribute("aria-invalid") === "true" &&
					steps.some((section) => section.hidden && section.contains(node)),
			);

		if (!target) return;

		const position = plan().indexOf(
			steps.findIndex((section) => section.contains(target)),
		);

		if (position < 0) return;
		showStep(position, false);
		target.focus();
	});

	observer.observe(form, {
		attributes: true,
		subtree: true,
		attributeFilter: ["aria-invalid"],
	});
	showStep(step, false);
	// The stylesheet keeps a linked brief's choice screen out of sight until now; Back can show it again.
	form.dataset.ready = "";
}

const form = document.querySelector<HTMLFormElement>("#software-inquiry");

if (form) setupSoftwareInquiry(form, setupSuggestionPass);
