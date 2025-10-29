import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable, Writable, pipeline} from 'node:stream';
import {promisify} from 'node:util';
import ByteCounterStreamNode from './node.js';
import ByteCounterStream, {byteLength} from './index.js';

const pipelineAsync = promisify(pipeline);

test('byteLength: ASCII string', () => {
	assert.equal(byteLength('Hello'), 5);
});

test('byteLength: string with emoji', () => {
	assert.equal(byteLength('Hello 👋'), 10);
});

test('byteLength: empty string', () => {
	assert.equal(byteLength(''), 0);
});

test('byteLength: Uint8Array', () => {
	assert.equal(byteLength(new Uint8Array([1, 2, 3])), 3);
});

test('byteLength: empty Uint8Array', () => {
	assert.equal(byteLength(new Uint8Array([])), 0);
});

test('byteLength: ArrayBuffer', () => {
	const buffer = new ArrayBuffer(5);
	assert.equal(byteLength(buffer), 5);
});

test('byteLength: SharedArrayBuffer', () => {
	const buffer = new SharedArrayBuffer(10);
	assert.equal(byteLength(buffer), 10);
});

test('byteLength: invalid types return 0', () => {
	assert.equal(byteLength(null), 0);
	assert.equal(byteLength(undefined), 0);
	assert.equal(byteLength(123), 0);
	assert.equal(byteLength({}), 0);
});

test('node: counts bytes from single write', () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	counter.write(encoder.encode('Hello'));
	counter.end();

	assert.equal(counter.count, 5);
});

test('node: counts bytes from multiple writes', () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	counter.write(encoder.encode('Hello '));
	counter.write(encoder.encode('World'));
	counter.end();

	assert.equal(counter.count, 11);
});

test('node: starts at zero', () => {
	const counter = new ByteCounterStreamNode();
	assert.equal(counter.count, 0);
});

test('node: passes data through unchanged', async () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	const input = encoder.encode('test data');
	const output = [];

	const writable = new Writable({
		write(chunk, encoding, callback) {
			output.push(chunk);
			callback();
		},
	});

	await pipelineAsync(
		Readable.from([input]),
		counter,
		writable,
	);

	const combined = new Uint8Array(output.reduce((acc, chunk) => acc + chunk.length, 0));
	let offset = 0;
	for (const chunk of output) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}

	assert.deepEqual(combined, input);
	assert.equal(counter.count, input.length);
});

test('node: counts bytes in pipeline', async () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	const chunks = [
		encoder.encode('chunk1'),
		encoder.encode('chunk2'),
		encoder.encode('chunk3'),
	];

	const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

	await pipelineAsync(
		Readable.from(chunks),
		counter,
		new Writable({
			write(chunk, encoding, callback) {
				callback();
			},
		}),
	);

	assert.equal(counter.count, totalSize);
});

test('node: count property is read-only', () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	counter.write(encoder.encode('test'));

	assert.equal(counter.count, 4);

	// Try to modify count (should throw in strict mode)
	assert.throws(() => {
		counter.count = 100;
	});

	assert.equal(counter.count, 4);
});

test('node: incremental counting', () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();

	assert.equal(counter.count, 0);

	counter.write(encoder.encode('a'));
	assert.equal(counter.count, 1);

	counter.write(encoder.encode('bc'));
	assert.equal(counter.count, 3);

	counter.write(encoder.encode('defg'));
	assert.equal(counter.count, 7);

	counter.end();
});

test('node: handles empty writes', () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	counter.write(encoder.encode(''));
	counter.write(encoder.encode('test'));
	counter.write(encoder.encode(''));
	counter.end();

	assert.equal(counter.count, 4);
});

test('node: works with string encoding', async () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const collected = [];

	await pipelineAsync(
		Readable.from([encoder.encode('Hello '), encoder.encode('World')]),
		counter,
		new Writable({
			write(chunk, encoding, callback) {
				collected.push(chunk);
				callback();
			},
		}),
	);

	// "Hello " (6 bytes) + "World" (5 bytes) = 11 bytes
	assert.equal(counter.count, 11);

	const combined = new Uint8Array(collected.reduce((acc, chunk) => acc + chunk.length, 0));
	let offset = 0;
	for (const chunk of collected) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}

	assert.equal(decoder.decode(combined), 'Hello World');
});

test('node: counts emoji bytes correctly', () => {
	const counter = new ByteCounterStreamNode();
	const encoder = new TextEncoder();
	counter.write(encoder.encode('👋'));
	counter.end();

	assert.equal(counter.count, 4);
});

test('web: counts bytes from single write', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const chunks = [];

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write(chunk) {
			chunks.push(chunk);
		},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(encoder.encode('Hello'));
	await writer.close();

	await readPromise;

	assert.equal(counter.count, 5);
	assert.equal(decoder.decode(chunks[0]), 'Hello');
});

test('web: counts bytes from multiple writes', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write() {},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(encoder.encode('Hello '));
	await writer.write(encoder.encode('World'));
	await writer.close();

	await readPromise;

	assert.equal(counter.count, 11);
});

test('web: starts at zero', () => {
	const counter = new ByteCounterStream();
	assert.equal(counter.count, 0);
});

test('web: passes data through unchanged', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const input = 'test data';
	const chunks = [];

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write(chunk) {
			chunks.push(chunk);
		},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(encoder.encode(input));
	await writer.close();

	await readPromise;

	const output = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}

	assert.equal(decoder.decode(output), input);
	assert.equal(counter.count, encoder.encode(input).byteLength);
});

test('web: count property is read-only', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write() {},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(encoder.encode('test'));
	await writer.close();

	await readPromise;

	assert.equal(counter.count, 4);

	// Try to modify count (should throw in strict mode)
	assert.throws(() => {
		counter.count = 100;
	});

	assert.equal(counter.count, 4);
});

test('web: handles empty writes', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write() {},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(encoder.encode(''));
	await writer.write(encoder.encode('test'));
	await writer.write(encoder.encode(''));
	await writer.close();

	await readPromise;

	assert.equal(counter.count, 4);
});

test('web: works with Uint8Array', async () => {
	const counter = new ByteCounterStream();
	const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write() {},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(data);
	await writer.close();

	await readPromise;

	assert.equal(counter.count, 5);
});

test('web: pipeThrough usage', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();
	const chunks = ['Hello ', 'World'];

	const stream = new ReadableStream({
		async start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}

			controller.close();
		},
	});

	const output = [];
	await stream
		.pipeThrough(counter)
		.pipeTo(new WritableStream({
			write(chunk) {
				output.push(chunk);
			},
		}));

	assert.equal(counter.count, 11);
	assert.equal(output.length, 2);
});

test('web: counts emoji bytes correctly', async () => {
	const counter = new ByteCounterStream();
	const encoder = new TextEncoder();

	const readPromise = counter.readable.pipeTo(new WritableStream({
		write() {},
	}));

	const writer = counter.writable.getWriter();
	await writer.write(encoder.encode('👋'));
	await writer.close();

	await readPromise;

	assert.equal(counter.count, 4);
});
