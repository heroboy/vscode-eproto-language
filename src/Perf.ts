import * as vscode from 'vscode';

/** 回调耗时超过这个值就记录一条 warning */
export const PERF_WARN_THRESHOLD_MS = 20;

let g_PerfOutput: vscode.OutputChannel | undefined;

export function getPerfOutputChannel(): vscode.OutputChannel
{
	if (!g_PerfOutput)
		g_PerfOutput = vscode.window.createOutputChannel('EPR Perf');
	return g_PerfOutput;
}

/**
 * 生成 warning 文本；未达到阈值时返回 null。
 * 单独拆出来便于测试阈值与格式，不需要真的去读 OutputChannel。
 */
export function formatPerfWarning(name: string, elapsedMs: number, detail?: string): string | null
{
	if (elapsedMs < PERF_WARN_THRESHOLD_MS)
		return null;

	const suffix = detail ? ` | ${detail}` : '';
	return `[WARN] ${name} ${elapsedMs.toFixed(1)}ms${suffix}`;
}

export function warnIfSlow(name: string, startedAt: number, detail?: string): void
{
	const text = formatPerfWarning(name, performance.now() - startedAt, detail);
	if (!text)
		return;

	getPerfOutputChannel().appendLine(`${new Date().toISOString()} ${text}`);
}

/**
 * 测量一个回调的耗时，超过阈值时写入 `EPR Perf` 输出通道。
 * detail 建议带上文件路径、行列、行数等定位信息。
 */
export function measureCallback<T>(name: string, callback: () => T, detail?: string): T
{
	const startedAt = performance.now();
	try
	{
		return callback();
	}
	finally
	{
		warnIfSlow(name, startedAt, detail);
	}
}
