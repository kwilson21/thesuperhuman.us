export type ProjectInvitation = {
	invitation_status: "pending" | "sending" | "sent" | "failed";
	invitation_attempted_at: string | null;
	invitation_sent_at: string | null;
};
