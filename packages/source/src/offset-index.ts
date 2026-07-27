import type Parser from "tree-sitter";
import type { SourcePosition, SourceRange } from "./types.js";

/**
 * Sole owner of native Tree-sitter UTF-16 indices, portable Tree-sitter UTF-8
 * byte offsets, and Nazare UTF-16 offsets. Conversion only accepts code-point
 * boundaries; splitting a surrogate pair is not a valid source edit.
 *
 * Native node-tree-sitter operations need only UTF-16 offsets. UTF-8 maps are
 * therefore built lazily for WASM/byte consumers instead of penalizing every
 * cold parse and incremental edit.
 */
export class SourceOffsetIndex {
	private utf16ToByte?: Int32Array;
	private byteToUtf16?: Int32Array;
	private readonly lineUtf16Starts: number[] = [0];
	private lineByteStarts?: number[];
	private resolvedByteLength?: number;
	readonly utf16Length: number;

	constructor(readonly source: string) {
		this.utf16Length = source.length;
		let newline = source.indexOf("\n");
		while (newline >= 0) {
			this.lineUtf16Starts.push(newline + 1);
			newline = source.indexOf("\n", newline + 1);
		}
	}

	get byteLength(): number {
		this.ensureByteIndex();
		return this.resolvedByteLength as number;
	}

	byteAt(utf16Offset: number): number {
		this.assertUtf16Boundary(utf16Offset);
		this.ensureByteIndex();
		return this.utf16ToByte?.[utf16Offset] as number;
	}

	utf16At(byteOffset: number): number {
		this.ensureByteIndex();
		this.assertOffset(
			byteOffset,
			this.resolvedByteLength as number,
			"UTF-8 byte",
		);
		const utf16Offset = this.byteToUtf16?.[byteOffset] as number;
		if (utf16Offset < 0) {
			throw new RangeError(
				`UTF-8 byte offset ${byteOffset} splits a code point`,
			);
		}
		return utf16Offset;
	}

	/** Native node-tree-sitter indices are JavaScript UTF-16 offsets. */
	treeIndexAt(utf16Offset: number): number {
		this.assertUtf16Boundary(utf16Offset);
		return utf16Offset;
	}

	utf16AtTreeIndex(treeIndex: number): number {
		this.assertUtf16Boundary(treeIndex);
		return treeIndex;
	}

	/** Native node-tree-sitter point columns are also UTF-16 code units. */
	treePointAt(utf16Offset: number): Parser.Point {
		this.assertUtf16Boundary(utf16Offset);
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
		return {
			row,
			column: byteOffset - (this.lineByteStarts?.[row] as number),
		};
	}

	positionAt(utf16Offset: number): SourcePosition {
		this.assertUtf16Boundary(utf16Offset);
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

	private ensureByteIndex(): void {
		if (this.utf16ToByte && this.byteToUtf16) return;
		const byteLength = Buffer.byteLength(this.source, "utf8");
		const utf16ToByte = new Int32Array(this.utf16Length + 1).fill(-1);
		const byteToUtf16 = new Int32Array(byteLength + 1).fill(-1);
		const lineByteStarts: number[] = [0];
		let utf16Offset = 0;
		let byteOffset = 0;
		utf16ToByte[0] = 0;
		byteToUtf16[0] = 0;
		for (const character of this.source) {
			utf16Offset += character.length;
			byteOffset += Buffer.byteLength(character, "utf8");
			utf16ToByte[utf16Offset] = byteOffset;
			byteToUtf16[byteOffset] = utf16Offset;
			if (character === "\n") lineByteStarts.push(byteOffset);
		}
		this.resolvedByteLength = byteLength;
		this.utf16ToByte = utf16ToByte;
		this.byteToUtf16 = byteToUtf16;
		this.lineByteStarts = lineByteStarts;
	}

	private assertUtf16Boundary(offset: number): void {
		this.assertOffset(offset, this.utf16Length, "UTF-16");
		if (
			offset > 0 &&
			offset < this.utf16Length &&
			isHighSurrogate(this.source.charCodeAt(offset - 1)) &&
			isLowSurrogate(this.source.charCodeAt(offset))
		) {
			throw new RangeError(`UTF-16 offset ${offset} splits a surrogate pair`);
		}
	}

	private assertOffset(offset: number, maximum: number, kind: string): void {
		if (!Number.isInteger(offset) || offset < 0 || offset > maximum) {
			throw new RangeError(`${kind} offset ${offset} is outside 0..${maximum}`);
		}
	}
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
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
