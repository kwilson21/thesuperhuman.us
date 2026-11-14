// Reads the operation and table of a SQL statement, for the golden corpus. Shared by the harness (which names what a
// failure or interleave hook hit) and `golden:neutral` (which compares which tables were changed when an outside effect
// happened). Statement text changes in a conversion; the operation and table are what should not.

/** SQL with comments and string literals removed, so a keyword inside either is not read as a statement. */
export const bare = (sql) =>
	sql
		.replace(/--[^\n]*/g, " ")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/'(?:[^']|'')*'/g, "''")
		.trim();

const IDENT = String.raw`["\`\[]?[A-Za-z_][A-Za-z0-9_]*["\`\]]?`;

// An optional schema (`main.`, `temp.`) is skipped; the table is the name after it.
const NAME = String.raw`(?:${IDENT}\s*\.\s*)?["\`\[]?([A-Za-z_][A-Za-z0-9_]*)["\`\]]?`;

const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE"]);

/** The statement a WITH ends in, as the text from its keyword. */
function afterWith(text) {
	const match = /\)\s*(insert|update|delete|replace)\b/i.exec(text);

	return match
		? text.slice(match.index + match[0].length - match[1].length)
		: null;
}

/**
 * { op, table, write } for one statement: `op` is INSERT, UPDATE, DELETE, REPLACE, SELECT or another first keyword, and
 * `write` is true for a statement that changes the database. A write whose table cannot be read throws, so a statement
 * form this reader does not know is loud and never a shared "unknown table" that compares equal.
 */
export function statementOf(sql) {
	let text = bare(sql);
	let keyword = /^[A-Za-z]+/.exec(text)?.[0].toUpperCase() ?? "";

	if (keyword === "WITH") {
		const tail = afterWith(text);

		if (tail) {
			text = tail;
			keyword = /^[A-Za-z]+/.exec(text)?.[0].toUpperCase() ?? "";
		} else keyword = "SELECT";
	}

	const schema = ["CREATE", "DROP", "ALTER"].includes(keyword);
	const write = WRITES.has(keyword) || schema;

	const pattern =
		keyword === "INSERT" || keyword === "REPLACE"
			? new RegExp(String.raw`\binto\s+${NAME}`, "i")
			: keyword === "UPDATE"
				? new RegExp(String.raw`^update\s+(?:or\s+\w+\s+)?${NAME}`, "i")
				: keyword === "DELETE" || keyword === "SELECT"
					? new RegExp(String.raw`\bfrom\s+${NAME}`, "i")
					: schema
						? new RegExp(
								String.raw`\b(?:table|index|view|trigger)\s+(?:if\s+(?:not\s+)?exists\s+)?${NAME}`,
								"i",
							)
						: null;

	const table = pattern?.exec(text)?.[1] ?? null;

	if (write && table === null)
		throw new Error(
			`cannot read the table this statement changes: ${sql.slice(0, 120)}`,
		);

	return { op: keyword, table, write };
}

/** Whether the SQL text changes the database. */
export const isWriteSql = (sql) => statementOf(sql).write;
