// A value that JSON.stringify writes out unchanged. File is admitted only
// because FormData.get is typed string | File: the forms whose values are
// posted through these types have text controls only, so it never occurs.
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| File
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

// A JSON request body posted to one of the site's API routes.
export type JsonBody = { [key: string]: JsonValue | undefined };
