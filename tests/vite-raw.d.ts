// Allow `import ... from "some-file?raw"` via Vite's raw import suffix.
declare module "*?raw" {
	const content: string;
	export default content;
}
