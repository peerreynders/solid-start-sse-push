const time = Intl.DateTimeFormat('en', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
});

function formatTime(date: Date) {
	return time.format(date);
}

const number = Intl.NumberFormat(undefined, {
	minimumFractionDigits: 3,
});

function formatNumber(value: number) {
	return number.format(value);
}

export { formatNumber, formatTime };
