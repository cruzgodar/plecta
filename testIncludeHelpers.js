// Fixture for the include() tests in spruce.test.js. include() should make
// every export below callable by bare name without importing them individually.
export function shout(x) { return x.toUpperCase() + "!"; }
export function wrap(x) { return `[${x}]`; }
