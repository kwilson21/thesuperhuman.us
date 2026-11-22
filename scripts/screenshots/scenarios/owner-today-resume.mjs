// A wholly fictional pending résumé request appears only in the protected owner preview.
const at = "2026-11-12T12:00:00.000Z";

export default {
	title: "Owner Today résumé request",
	async run({ capture, sql, kvPut }) {
		kvPut(
			"RESUME_STORE",
			"req:screenshot-resume",
			JSON.stringify({
				name: "Sample Requester",
				email: "requester@example.test",
				company: "Sample Studio",
				audience: "general",
				note: "Synthetic screenshot fixture.",
				ts: Date.parse(at),
			}),
		);
		sql(`INSERT OR IGNORE INTO owner_campaigns(id,subject_type,subject_id,name,primary_goal,starts_at,status,created_at,updated_at)
      VALUES ('screenshot-campaign','release','old-news-single','Old News premiere','Grow saved listeners','2026-09-01','active','${at}','${at}')`);

		const images = [];

		for (const viewport of ["desktop", "phone"]) {
			const file = await capture({
				file: `owner-today-resume-${viewport}.png`,
				path: "/owner",
				viewport,
				owner: true,
				prepare: async (page) => {
					await page.getByText("Sample Requester", { exact: true }).waitFor();
					await page.getByText(/requester@example\.test/).waitFor();
				},
			});

			images.push({ file, caption: `Owner Today résumé request, ${viewport}` });
		}

		return [{ title: "Owner Today résumé request", images }];
	},
};
