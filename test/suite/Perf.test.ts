import * as assert from 'assert';
import { formatPerfWarning, PERF_WARN_THRESHOLD_MS } from '../../src/Perf';

suite('Perf Tests', () =>
{
	test('does not warn below the threshold', () =>
	{
		assert.strictEqual(
			formatPerfWarning('provideCompletionItems', PERF_WARN_THRESHOLD_MS - 0.1),
			null
		);
	});

	test('warns at or above the threshold with callback and detail', () =>
	{
		const text = formatPerfWarning(
			'provideCompletionItems',
			PERF_WARN_THRESHOLD_MS,
			'test.epr:1:2 (10 lines)'
		);

		assert.ok(text);
		assert.ok(text.startsWith('[WARN] provideCompletionItems'));
		assert.ok(text.includes('20.0ms'));
		assert.ok(text.includes('test.epr:1:2 (10 lines)'));
	});
});
