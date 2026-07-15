export type Output = {
	log: (...values: unknown[]) => void;
	error: (...values: unknown[]) => void;
};
