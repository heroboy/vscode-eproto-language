export function isWhiteSpace(c: string)
{
	return ' \t\r\n'.indexOf(c) !== -1;
}

export function isPunc(c: string)
{
	return ';=+-*/'.indexOf(c) !== -1;
}

export function isSymbolChar(c:string)
{
	return /[a-zA-Z0-9_]/.test(c);
}