import type Parser from "tree-sitter";
import type { SourcePosition, SourceRange } from "./types.js";

/**
 * Sole owner of native Tree-sitter UTF-16 indices, portable Tree-sitter UTF-8
 * byte offsets, and Nazare UTF-16 offsets. Conversion only accepts code-point
 * boundaries; splitting a surrogate pair is not a valid source edit.
 */
export class SourceOffsetIndex {
	private readonly utf16ToByte: Int32Array;
	private readonly byteToUtf16: Int32Array;
	private readonly lineUtf16Starts: number[] = [0];
	private readonly lineByteStarts: number[] = [0];
	readonly utf16Length: number;
	readonly byteLength: number;

	constructor(readonly source: string) {
		this.utf16Length = source.length;
		this.byteLength = Buffer.byteLength(source, "utf8");
		this.utf16ToByte = new Int32Array(this.utf16Length + 1).fill(-1);
		this.byteToUtf16 = new Int32Array(this.byteLength + 1).fill(-1);

		let utf16Offset = 0;
		let byteOffset = 0;
		this.recordBoundary(utf16Offset, byteOffset);
		for (const character of source) {
			const utf16Width = character.length;
			const byteWidth = Buffer.byteLength(character, "utf8");
			utf16Offset += utf16Width;
			byteOffset += byteWidth;
			this.recordBoundary(utf16Offset, byteOffset);
			if (character === "\n") {
				this.lineUtf16Starts.push(utf16Offset);
				this.lineByteStarts.push(byteOffset);
			}
		}
	}

	byteAt(utf16Offset: number): number {
		this.assertOffset(utf16Offset, this.utf16Length, "UTF-16");
		const byteOffset = this.utf16ToByte[utf16Offset] as number;
		if (byteOffset < 0) {
			throw new RangeError(
				`UTF-16 offset ${utf16Offset} splits a surrogate pair`,
			);
		}
		return byteOffset;
	}

	utf16At(byteOffset: number): number {
		this.assertOffset(byteOffset, this.byteLength, "UTF-8 byte");
		const utf16Offset = this.byteToUtf16[byteOffset] as number;
		if (utf16Offset < 0) {
			throw new RangeError(
				`UTF-8 byte offset ${byteOffset} splits a code point`,
			);
		}
		return utf16Offset;
	}

	/** Native node-tree-sitter indices are JavaScript UTF-16 offsets. */
	treeIndexAt(utf16Offset: number): number {
		this.byteAt(utf16Offset);
		return utf16Offset;
	}

	utf16AtTreeIndex(treeIndex: number): number {
		this.byteAt(treeIndex);
		return treeIndex;
	}

	/** Native node-tree-sitter point columns are also UTF-16 code units. */
	treePointAt(utf16Offset: number): Parser.Point {
		this.byteAt(utf16Offset);
		const row = lineForOffset(this.lineUtf16Starts, utf16Offset);
		return {
			row,
			column: utf16Offset - (this.lineUtf16Starts[row] as number),
		};
	}

	/** UTF-8 point for WASM/C runtime adapters. */
	bytePointAt(utf16Offset: number): Parser.Point {
		const byteOffset = this.byteAt(utf16Offset);
		const row = lineForOffset(this.lineUtf16Starts, utf16Offset);
		return { row, column: byteOffset - (this.lineByteStarts[row] as number) };
	}

	positionAt(utf16Offset: number): SourcePosition {
		this.byteAt(utf16Offset);
		const row = lineForOffset(this.lineUtf16Starts, utf16Offset);
		return {
			line: row + 1,
			column: utf16Offset - (this.lineUtf16Starts[row] as number) + 1,
		};
	}

	rangeFromBytes(startByte: number, endByte: number): SourceRange {
		return { start: this.utf16At(startByte), end: this.utf16At(endByte) };
	}

	rangeFromTreeIndices(startIndex: number, endIndex: number): SourceRange {
		return {
			start: this.utf16AtTreeIndex(startIndex),
			end: this.utf16AtTreeIndex(endIndex),
		};
	}

	private recordBoundary(utf16Offset: number, byteOffset: number): void {
		this.utf16ToByte[utf16Offset] = byteOffset;
		this.byteToUtf16[byteOffset] = utf16Offset;
	}

	private assertOffset(offset: number, maximum: number, kind: string): void {
		if (!Number.isInteger(offset) || offset < 0 || offset > maximum) {
			throw new RangeError(`${kind} offset ${offset} is outside 0..${maximum}`);
		}
	}
}

function lineForOffset(starts: readonly number[], offset: number): number {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if ((starts[middle] as number) <= offset) low = middle;
		else high = middle - 1;
	}
	return low;
}
