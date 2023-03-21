const MAX_VALUE = 0xffff_ffff;
const randomPool = new Uint32Array(128);

let randomTop = -1;

function nextValue(): number {
	if (randomTop < 0) {
		crypto.getRandomValues(randomPool);
		randomTop = randomPool.length - 1;
	}
	return randomPool[randomTop--];
}

export { MAX_VALUE, nextValue };
